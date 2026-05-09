## Why

The Data Pipeline Editor (HEL-141) needs a field-selection operation so users can narrow a row set to only the columns they care about before downstream steps. Without it, pipelines carry all columns through every step, making results harder to read and subsequent transforms noisier. This is the first v1 op to ship after the step infrastructure (HEL-228, HEL-229).

## What Changes

- **Flyway migration** adds `'select'` to the `pipeline_steps.op` CHECK constraint (new V-migration, additive).
- **Backend engine** gains a `select` op handler: given a `fields` array in the step config, it retains only those column names in each row and drops the rest.
- **Frontend step-config UI** renders a checklist of field names drawn from the previous step's inferred output schema; checked fields are kept, unchecked are dropped.
- `JsonProtocols` / domain constants updated to include `"select"` wherever the op enum is referenced in Scala.

## Capabilities

### New Capabilities

- `pipeline-select-op`: Backend execution engine support for the `select` op and the corresponding frontend config UI (field checklist).

### Modified Capabilities

- `pipeline-steps-persistence`: The DB CHECK constraint now includes `'select'`; the allowed-op list changes at the persistence layer.
- `pipeline-run-execution`: The execution engine now handles a new op type (`select`); the spec must document its config shape and behaviour.

## Impact

- One new Flyway migration (additive, no data loss).
- Backend: `PipelineStepExecutor` (or equivalent dispatcher) gains a `select` case; `JsonProtocols` or op-enum constant updated.
- Frontend: step-config component/panel gains a `select` branch rendering a field checklist; no new Redux slice needed (existing pipeline-steps state covers it).
- No breaking API changes — existing steps with other op types are unaffected.

## Non-goals

- Field reordering (column order is not guaranteed by this op).
- Wildcards or regex field selection.
- Persisting inferred schemas server-side; field list is derived client-side from the previous step's in-memory result.
