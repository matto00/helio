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

#### Scenario: Undo restores order and deleted steps
- **WHEN** a save reordered steps and deleted an unbound step, and nothing changed since
- **THEN** undo restores the prior order and recreates the step under its original id in one transaction

#### Scenario: Later edit blocks undo
- **WHEN** the pipeline changed after the save
- **THEN** undo returns 409 `PATCH_SET_STALE` and writes nothing

#### Scenario: Cascade removed panels or alert rules
- **WHEN** the save's cascade removed a bound panel or a targeting alert rule
- **THEN** undo returns 409 naming each such panel and alert rule and writes nothing
