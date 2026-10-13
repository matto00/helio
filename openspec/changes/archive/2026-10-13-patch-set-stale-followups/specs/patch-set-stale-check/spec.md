## MODIFIED Requirements

### Requirement: Preview returns a fingerprint per update/delete target

`POST /api/patch-sets/preview` SHALL return, on each `update` and `delete` edit's preview entry, a non-empty opaque
string `fingerprint` derived from the target's current state restricted to the fields that kind's update request can
write. For a dataSource and a pipeline it is derived from everything apply reads or overwrites, including what a delete
removes: a dataSource's name, type, redacted config, tag and schema (a dataset's declared schema, never row-derived state); a
pipeline's name, tag, roots and the steps, Outputs (with the panels bound to them and the alert rules targeting them) and
schedule deleted with it (never dataset rows, file bytes or run history). A `delete` edit on an `output` SHALL also cover
the ids of the panels bound to that Output and the alert rules targeting it. A `delete` edit on a `pipelineStep` SHALL
also cover every step the delete removes (the target and the tail subtrees removed with it; the promoted head child and
its subtree survive and are not covered) and every Output on a removed step, with that Output's bound panel ids and
targeting alert rules. An `update` edit's fingerprint on an `output` or `pipelineStep` SHALL NOT cover those cascaded
rows. A `create` edit's entry SHALL carry no fingerprint. The fingerprint SHALL change when any field it covers changes,
and SHALL NOT change when only server-maintained fields change (timestamps, run status/counters, version counters,
server-materialized config, an Output's stored schema). One exception is documented, not hidden: the first run of an
`upsertsource` step whose target is a new source rewrites that step's stored config to point at the dataset the run
created, so a fingerprint covering that step (its pipeline, or the step itself) taken before that run differs after it
and the apply is refused as stale. This fails safe; the caller re-previews.

#### Scenario: Update and delete edits carry fingerprints

- **WHEN** a patch set with one panel update, one pipelineStep delete and one pipelineStep create is previewed
- **THEN** the update and delete entries each carry a non-empty `fingerprint` and the create entry carries none

#### Scenario: Fingerprint is stable across a pipeline run

- **WHEN** a pipeline update edit is previewed twice with a pipeline run completing between the two previews (its run
  status recorded and an Output's schema rewritten), and the pipeline has no `upsertsource` step targeting a new source
- **THEN** both previews return the same fingerprint for that edit

#### Scenario: An upsertsource step's first run stales an earlier preview

- **WHEN** a pipeline with an `upsertsource` step targeting a new source is previewed for update, and that step's first
  run then rewrites its target to the dataset it created
- **THEN** a second preview returns a different fingerprint, and an apply carrying the first is refused with 409
  PATCH_SET_STALE and nothing is applied

#### Scenario: Fingerprint changes on a dataSource or pipeline definition change

- **WHEN** a dataset's declared schema (required, default or a column type), or a pipeline's steps (including a
  reorder or a reparent), Outputs (including an Output's kind or node step), bound panels, alert rules (including an
  edit to an existing rule) or schedule (including `enabled` or `timezone`), are changed through their own services or
  repositories between a preview and an apply carrying that preview's fingerprint, for an update or a delete edit
- **THEN** the apply is refused with 409 PATCH_SET_STALE and nothing is applied

#### Scenario: An output delete is refused after its cascade changed

- **WHEN** an output delete edit is previewed, and before apply a panel is bound to that Output, or an alert rule
  targeting it is created, edited or deleted
- **THEN** the apply carrying the preview's fingerprint is refused with 409 PATCH_SET_STALE and the Output still exists

#### Scenario: A pipelineStep delete is refused after its cascade changed

- **WHEN** a pipelineStep delete edit is previewed, and before apply a panel is bound to an Output on that step or on a
  step in a tail subtree the delete removes, or an alert rule targeting such an Output is created
- **THEN** the apply carrying the preview's fingerprint is refused with 409 PATCH_SET_STALE and the step still exists

#### Scenario: Cascade changes do not stale output or step updates

- **WHEN** an output update edit or a pipelineStep update edit is previewed twice with a panel bound to the affected
  Output between the two previews
- **THEN** both previews return the same fingerprint for that edit

#### Scenario: Row writes do not change a dataset's fingerprint

- **WHEN** rows are appended to or replaced in a dataset between two previews of the same edit
- **THEN** both previews return the same fingerprint

#### Scenario: Fingerprint changes on an editable-field change

- **WHEN** a panel's title is changed through `PATCH /api/panels/:id` between two previews of the same edit
- **THEN** the two previews return different fingerprints
