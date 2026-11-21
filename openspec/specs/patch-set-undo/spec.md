# patch-set-undo Specification

## Purpose
Lets a user or agent undo the last successfully-applied patch set, restoring every touched
resource to its pre-apply state via the same per-resource services the apply path uses —
atomically, and only when doing so is safe: a resource changed since the original apply, or a
structurally-unrecoverable delete, refuses the whole undo rather than silently overwriting or
partially restoring.

## Requirements

### Requirement: Undo SHALL atomically restore every journaled edit's pre-apply state
`POST /api/patch-sets/:id/undo` SHALL restore every edit in the named application to its pre-apply
state via the same per-resource services the apply path uses, or restore none of them, for every
condition detectable before any restore begins (a conflict, or a structurally-unrecoverable delete
edit) — see the separate requirement below for the narrower guarantee that applies only to a genuine,
undetectable-in-advance restore failure.

#### Scenario: Undo restores every touched resource to its pre-apply state
- **WHEN** `POST /api/patch-sets/:id/undo` is called with a valid, owned, unconflicted
  `applicationId`
- **THEN** every resource the original application touched is restored to the value it had
  immediately before that application ran

#### Scenario: An unowned or nonexistent applicationId is rejected
- **WHEN** `POST /api/patch-sets/:id/undo` is called with an id that does not exist, or is not owned
  by the caller
- **THEN** the call is rejected (not found) and no resource is modified

#### Scenario: Restoring a pipeline step preserves its captured enabled/disabled state
- **WHEN** `POST /api/patch-sets/:id/undo` restores a `pipelineStep` edit — whether by recreating a
  deleted step or by fully reverting an updated one — and the captured pre-apply state had that step
  `enabled: false`
- **THEN** the restored step is `enabled: false`, never silently reset to `enabled: true`
- **AND** a captured pre-apply state with no `enabled` field recorded (a legacy record predating the
  field's introduction) restores as `enabled: true`

### Requirement: A resource changed since the original apply SHALL refuse the whole undo
Before restoring anything, undo SHALL compare each `update`/`create` edit's target's current live
state — restricted to the fields that edit's own restore would touch, never dynamic or
server-materialized fields unrelated to the original edit — against the state captured immediately
after the original apply; any mismatch SHALL refuse the entire undo without restoring any edit in
that application.

#### Scenario: A conflicting edit refuses the whole undo, not just that edit
- **WHEN** `POST /api/patch-sets/:id/undo` is called and at least one touched resource's
  edit-relevant fields were modified by something else since the original apply
- **THEN** the call is rejected with a conflict error naming the conflicting edit(s), and every
  resource in that application — including the ones that were NOT independently modified — remains
  exactly as it was before the undo call

#### Scenario: An unrelated field changing since apply is not treated as a conflict
- **WHEN** `POST /api/patch-sets/:id/undo` is called and a touched pipeline has run again (updating
  its last-run status/timestamp/row-count) since the original apply, with no other change to the
  fields that edit's undo would restore
- **THEN** the call is NOT rejected as a conflict on that basis alone

#### Scenario: A raw override on a metric-bound panel field IS treated as a conflict
- **WHEN** `POST /api/patch-sets/:id/undo` is called and a touched `MetricPanel` (with `metricId`
  unchanged since the original apply) had its raw `outputId`/`fieldMapping`/`aggregation`/`unit`
  independently changed since the original apply
- **THEN** the call is rejected as a conflict — this is NOT the same excluded category as the bound
  metric's own current deprecated/effective state changing with no raw-field edit

### Requirement: A structurally-unrecoverable delete edit SHALL refuse the whole undo, never a partial restore
Before restoring anything, undo SHALL treat a journaled `delete` edit whose kind has no restoring
create API (`dashboard`/`dataSource`/`dataType`/`pipeline`) as a Phase-1 blocker, identically to a
conflict — refusing the entire undo rather than restoring the application's other edits while leaving
that one unrestored.

#### Scenario: An application containing an unrecoverable delete-kind refuses the whole undo
- **WHEN** `POST /api/patch-sets/:id/undo` is called on an application that includes a `pipeline`
  delete edit
- **THEN** the call is rejected, naming that edit as structurally unrecoverable, and every resource
  in that application — including ones an update/create edit touched — remains unrestored

### Requirement: An unforeseeable restore failure SHALL report an honest partial outcome
Undo SHALL, if a restore step fails for a reason the pre-restore checks could not have detected (e.g.
a delete-edit's recreate target having lost its own required parent resource independently since the
original apply), stop restoring further edits in that application and report every not-yet-attempted
edit as `notAttempted`, and SHALL NOT attempt to reverse edits already restored earlier in that same
call.

#### Scenario: An unforeseeable mid-restore failure reports a mixed outcome honestly
- **WHEN** restoring one edit in an otherwise-eligible application fails for a reason no pre-restore
  check could have caught
- **THEN** the response reports that edit's failure, reports every edit after it as `notAttempted`,
  and leaves every edit already restored earlier in that same call in its restored state — never
  silently reversing them and never reporting the failed/unattempted edits as restored

### Requirement: Journal retention SHALL be bounded per owner
The backend SHALL retain at most the 20 most-recent application records per owner, pruning older
ones on each new journal write.

#### Scenario: A 21st application prunes the oldest
- **WHEN** an owner's 21st successful application is journaled
- **THEN** that owner's oldest previously-journaled application record no longer exists

#### Scenario: Undoing a pruned application behaves like undoing a nonexistent one
- **WHEN** `POST /api/patch-sets/:id/undo` is called with an `applicationId` that was pruned by
  retention
- **THEN** the call is rejected (not found), identically to any other nonexistent id

### Requirement: Undo of a pipeline-step patch restores PipelineStep.enabled exactly
Undoing an applied patch-set operation on a `PipelineStep` SHALL restore that step's `enabled`
field to its prior value exactly, via `fullPipelineStepInverse`/`pipelineStepCreateRequestFromPrior`
explicitly setting `enabled = prior.enabled` (HEL-766) rather than relying on
`CreatePipelineStepRequest.enabled`'s own default.

#### Scenario: Undo restores a step's prior enabled state
- **WHEN** an applied patch-set operation that changed a `PipelineStep`'s `enabled` field is undone
- **THEN** the step's `enabled` field reverts to its value before the patch was applied

#### Scenario: Undo restores a removed placement
- **WHEN** an applied patch-set operation removed a dashboard placement and is then undone
- **THEN** the placement is recreated with the same `outputId` and position it had before removal

### Requirement: Restored Output configs SHALL NOT reintroduce V117-repaired dead config keys
Whenever a patch-set undo or mid-apply rollback writes a previously captured Output config back to storage, the
backend SHALL first apply the same rename/drop mapping that migration V117 applies (HEL-1387), so the written config is
exactly what V117 would have produced from the config being written (the captured config for an undo recreate; the
stored config merged with the captured config for a mid-apply rollback). The journal itself SHALL NOT be rewritten.

#### Scenario: Undoing a pre-V117 step delete renames a dead metric label
- **WHEN** a `pipelineStep` delete journaled with a bound metric Output whose config holds `"metricLabel": "Revenue"`
  and no `label` is undone
- **THEN** the recreated Output's config holds `"label": "Revenue"` and no `metricLabel`

#### Scenario: Dead keys with no live equivalent are dropped on restore
- **WHEN** the journaled config of a restored table Output holds `tableDensity` and `columnWidths`
- **THEN** the recreated Output's config holds neither key and every other key is unchanged

#### Scenario: A non-null live key is never overwritten on restore
- **WHEN** the journaled config of a restored metric Output holds both `"label": "Live"` and `"metricLabel": "Old"`
- **THEN** the written config holds `"label": "Live"` and no `metricLabel`

#### Scenario: The restore mapping matches V117 exactly
- **WHEN** any Output kind and config is passed through V117's repair and through the restore-time normalisation
- **THEN** both produce the identical config

### Requirement: Restored Output configs SHALL NOT reintroduce V118-repaired object-valued format
Whenever a patch-set undo or mid-apply rollback writes a previously captured Output config back to storage, the
backend SHALL apply migration V118's `format` mapping (HEL-1410) after V117's dead-key mapping, so the written config
is exactly what V117 followed by V118 would have produced from the config being written. The journal itself SHALL NOT
be rewritten, and no audit row is written for restore-time normalisation.

#### Scenario: Undoing a pre-V118 step delete maps an object format to a string format
- **WHEN** a `pipelineStep` delete journaled with a bound metric Output whose config holds
  `"format": {"prefix": "$", "decimals": 2}` and no `unit` is undone
- **THEN** the recreated Output's stored config holds `"format": "currency"` and no `unit` key is added

#### Scenario: Legacy format text moves into an absent unit on a metric
- **WHEN** the journaled config of a restored metric Output holds `"format": {"unit": "kg", "decimals": 0}` and no `unit`
- **THEN** the recreated Output's stored config holds `"format": "integer"` and `"unit": "kg"`

#### Scenario: A non-null live unit is never overwritten
- **WHEN** the journaled config of a restored metric Output holds `"unit": "live"` and `"format": {"unit": "kg"}`
- **THEN** the written config holds `"unit": "live"` and `"format": "number"`

#### Scenario: Collections get a string format and never a unit
- **WHEN** the journaled config of a restored collection Output holds `"format": {"suffix": "pts"}`
- **THEN** the written config holds `"format": "number"` and no `unit` key

#### Scenario: The restore format mapping matches V118 exactly
- **WHEN** any Output kind and config is passed through V118's repair and through the restore-time format normalisation
- **THEN** both produce the identical config

### Requirement: Undo of a pipeline create SHALL remove the unreferenced inline root sources that create made

When a journaled `pipeline` `create` edit is undone, the system SHALL delete the pipeline and then each inline root
source that the original apply created, through the same reference-guarded source delete the API uses, and then the
implicit "Auto:" Connector of a bare-`url` REST inline root once its source is gone. A source that is still referenced
SHALL be kept. Sources the apply did not create (roots given by `sourceId`) SHALL never be deleted. The edit's undo
outcome SHALL report each journaled inline source as `removed`, `kept` or `alreadyGone`. A journal entry written before
the apply recorded its inline sources SHALL keep today's behaviour: only the pipeline is deleted and no inline-source
report is returned.

#### Scenario: Unreferenced inline root source is removed on undo
- **WHEN** a patch set whose `pipeline` `create` edit used an inline root is applied and then undone
- **THEN** the pipeline and the inline source are both gone, and the outcome lists the source as `removed`

#### Scenario: Inline source referenced since the apply is kept and reported
- **WHEN** after the apply, another pipeline adds the inline source as a root, and the patch set is then undone
- **THEN** the undo succeeds, the created pipeline is gone, the source survives, and the outcome lists it as `kept`

#### Scenario: A pre-existing root source is never deleted
- **WHEN** the `pipeline` `create` edit named an existing source by `sourceId`, and the patch set is undone
- **THEN** that source survives and is not listed in the outcome

#### Scenario: Implicit Connector of a bare-url REST inline root is removed with its source
- **WHEN** the inline root was a `rest_api` root given as a bare `url`, and the patch set is undone
- **THEN** the source and its implicit "Auto:" Connector are both gone

#### Scenario: A source that could not be removed is reported kept with a fixed reason
- **WHEN** deleting a journaled inline source fails for any reason other than a reference conflict
- **THEN** the undo still succeeds, and the outcome lists the source as `kept` with a fixed reason that carries no internal detail

#### Scenario: A create with no inline roots reports nothing
- **WHEN** every root of the `pipeline` `create` edit named an existing source, and the patch set is undone
- **THEN** the outcome carries no `inlineSources` field

#### Scenario: Legacy journal entry keeps today's behaviour
- **WHEN** a `pipeline` `create` journal entry carries no recorded inline sources and is undone
- **THEN** only the pipeline is deleted, the source survives, and the outcome carries no `inlineSources`

### Requirement: Undo of a pipeline-definition save
`POST /api/patch-sets/:id/undo` SHALL dispatch a `pipelineDefinition` journal row to an atomic restore that re-applies
the journaled prior definition through the draft-save transaction against the post-save fingerprint, including trunk
order, recreating deleted steps and Outputs under their original ids.

When the restore would delete an Output the save created that now has bound panels or targeting alert rules, or when
the save's cascade removed a bound panel or targeting alert rule, undo SHALL refuse with a conflict error and write
nothing, regardless of which user owns the panel or rule. A refusal message SHALL NOT contain any panel id. It SHALL
name a blocking panel bound to a created Output only by panel title and dashboard name, and only when the undoing user
can read that panel and its dashboard; every other blocking panel SHALL be reported only as a count. A targeting alert
rule SHALL be named only when the undoing user owns it, else counted. Panels and alert rules the save's cascade removed
SHALL be reported only as counts. When both apply, one message SHALL report the removed counts and then the created-Output
blockers. A refusal raised inside the restore transaction SHALL report counts only.

#### Scenario: Undo restores order and deleted steps
- **WHEN** a save reordered steps and deleted an unbound step, and nothing changed since
- **THEN** undo restores the prior order and recreates the step under its original id in one transaction

#### Scenario: Later edit blocks undo
- **WHEN** the pipeline changed after the save
- **THEN** undo returns 409 `PATCH_SET_STALE` and writes nothing

#### Scenario: Cascade removed panels or alert rules
- **WHEN** the save's cascade removed a bound panel or a targeting alert rule
- **THEN** undo returns 409 reporting how many panels and alert rules were removed, with no panel or alert rule id, and
  writes nothing

#### Scenario: Another user's panel bound to an Output the save created
- **WHEN** user A saves a draft that creates an Output, user B (an editor on A's dashboard) duplicates a panel bound to
  that Output so that B owns the copy, and A undoes the save
- **THEN** undo returns 409 naming B's panel by title and dashboard name, the body contains no panel id, and the
  Output, B's panel and the pipeline definition are unchanged

#### Scenario: A blocking panel the undoing user cannot read is counted, not named
- **WHEN** a panel on a dashboard the undoing user cannot read is bound to an Output the save created, and the user
  undoes the save
- **THEN** undo returns 409 with a count of such panels and without that panel's id, title or dashboard name, and
  nothing changes

#### Scenario: A bind that lands after the pre-check is not deleted silently
- **WHEN** a panel is bound to a created Output after the pre-check passed but before the restore transaction reads the
  definition
- **THEN** undo returns 409 `PATCH_SET_STALE` with no panel id, and nothing changes

#### Scenario: Alert rules on a created Output are named only for their owner
- **WHEN** an alert rule targets an Output the save created and the user undoes the save
- **THEN** undo returns 409 naming the rule by name with no rule id when the undoing user owns it, and otherwise
  reporting only a count with neither its id nor its name, and nothing changes

#### Scenario: Removed and newly bound panels together
- **WHEN** the save's cascade removed a bound panel and a panel is now bound to an Output the save created
- **THEN** undo returns one 409 reporting the removed count and the created-Output blockers, with no panel id

### Requirement: Undo SHALL refuse when a resource it would delete carries panels the patch set did not create
Before restoring anything, undo SHALL find every panel that the undo of an `output`, `pipelineStep`, `pipeline` or `dashboard` `create` edit would delete. For an Output that is a panel bound to it. For a pipeline step it is a panel bound to any Output on a step that the step delete would remove, which includes the descendant steps the delete removes with it. For a pipeline it is a panel bound to any Output of that pipeline. For a dashboard it is a panel on that dashboard. If any such panel was not created by the same patch set, undo SHALL refuse the whole undo with a conflict error and restore no edit. Only panels the same patch set itself created (its `panel` `create` edits) are excused, because the reverse walk deletes them before the resource. This holds regardless of which user owns the panel.

The conflict message SHALL name each blocking panel the undoing user can read, by panel title and dashboard name. It SHALL report only a count of blocking panels the undoing user cannot read, never their titles or dashboard names.

#### Scenario: Another user's panel bound to a created Output refuses the undo
- **WHEN** user A applies a patch set that creates an Output, user B (an editor on A's dashboard) duplicates a panel bound to that Output so that B owns the copy, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error naming B's panel, and the Output, B's panel and every other resource in that application remain exactly as they were before the undo call

#### Scenario: A panel the same user bound after the apply refuses the undo
- **WHEN** user A applies a patch set that creates an Output, A then binds a new panel to it outside the patch set, and A undoes
- **THEN** the call is rejected with a conflict error naming that panel, and nothing is restored

#### Scenario: Panels the patch set itself created do not block
- **WHEN** a patch set creates an Output and a panel bound to it, nothing else binds to the Output, and the applying user undoes
- **THEN** the undo succeeds and removes both the panel and the Output

#### Scenario: A blocking panel the undoing user cannot read is counted, not named
- **WHEN** an undo is refused because of a blocking panel on a dashboard the undoing user cannot read
- **THEN** the conflict message includes a count of such panels and does not include that panel's title or its dashboard's name

#### Scenario: Pipeline-step, pipeline and dashboard create undos are guarded the same way
- **WHEN** the undo of a `pipelineStep`, `pipeline` or `dashboard` create edit would delete a panel the patch set did not create
- **THEN** the whole undo is refused with a conflict error and nothing is restored

#### Scenario: A panel bound to an Output on a descendant step that the step delete removes refuses the undo
- **WHEN** a patch set creates a pipeline step, a second child step is later added under it (so deleting the step would remove that child), an Output is created on the child and a panel is bound to it, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the child step, its Output and the panel remain

#### Scenario: A bind that lands during the undo is not deleted silently
- **WHEN** a panel is bound to a created Output after undo's pre-check passed but before the Output is deleted
- **THEN** the Output is not deleted, the panel remains, and the undo reports that edit as failed rather than restored

### Requirement: Undo SHALL refuse when it would delete Outputs or pipeline steps the patch set did not create
Before restoring anything, undo SHALL find every Output and every pipeline step that the undo of a `pipeline` or `pipelineStep` `create` edit would delete. For a pipeline that is every Output and every step of that pipeline. For a pipeline step it is every descendant step the step delete removes with it, and every Output on the step or on those descendants. If any such Output or step was not created by the same patch set, undo SHALL refuse the whole undo with a conflict error and restore no edit. Only Outputs and steps the same patch set itself created are excused: those its `output` and `pipelineStep` `create` edits created, and those its `pipeline` or `pipelineStep` `create` edit made as part of that create. This holds regardless of which user created or owns the Output or step.

The conflict message SHALL name each blocking Output the undoing user can read, by Output name, and SHALL report only a count of blocking Outputs the undoing user cannot read, never their names or ids. Blocking steps SHALL be described without their ids. No id of a blocking Output or step SHALL appear in the message.

#### Scenario: An Output an editor added to a created pipeline refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, user B (an editor grantee on that pipeline) adds an Output to it, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error naming B's Output, and the pipeline, B's Output and every other resource in that application remain exactly as they were before the undo call

#### Scenario: An Output the same user added after the apply refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, A then adds an Output to it outside the patch set, and A undoes
- **THEN** the call is rejected with a conflict error naming that Output, and nothing is restored

#### Scenario: A step added to a created pipeline after the apply refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, a step is then added to it outside the patch set (by A or by an editor), and A undoes
- **THEN** the call is rejected with a conflict error and nothing is restored

#### Scenario: Outputs and steps the patch set itself created do not block
- **WHEN** a patch set creates a pipeline with inline steps and Outputs, nothing else is added to the pipeline, and the applying user undoes
- **THEN** the undo succeeds and removes the pipeline with its steps and Outputs

#### Scenario: A later Output on a created step refuses the undo
- **WHEN** a patch set creates a pipeline step on an existing pipeline, an Output (or a descendant step) is later added on it outside the patch set, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the step and the later Output remain

#### Scenario: An Output added during the undo is not deleted silently
- **WHEN** an Output is added to a created pipeline after undo's pre-check passed but before the pipeline is deleted, and the re-check immediately before the delete sees it
- **THEN** the pipeline is not deleted and the undo reports that edit as failed rather than restored
