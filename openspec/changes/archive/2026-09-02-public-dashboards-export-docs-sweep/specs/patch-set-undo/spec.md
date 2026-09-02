## MODIFIED Requirements

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

