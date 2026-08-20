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
  unchanged since the original apply) had its raw `dataTypeId`/`fieldMapping`/`aggregation`/`unit`
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

