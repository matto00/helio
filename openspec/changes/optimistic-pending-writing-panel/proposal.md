## Why

The counter control already advances an optimistic tally on click and reverts it on submit failure,
but never reconciles against anything real — a reload or second device shows a different number.
The design spec's "Optimistic state" bullet requires the value to become authoritative on success and
roll back visibly on failure, without ever spinning forever on a downstream pipeline that may not
exist or may be denied by the cost gate (owner ruling, HEL-1095 Planning escalation).

## What Changes

- Add a small, ACL-scoped backend aggregate query (`sum(delta)` per field) over `dataset_rows`,
  reusing the existing `(data_source_id, seq)` index — no new table or migration.
- After a counter submit succeeds, refetch this aggregate and replace the optimistic tally,
  reconciling against any still-in-flight optimistic deltas rather than overwriting.
- **Deviation, per owner ruling:** "on run success" means "on write success" — reconciliation is
  decoupled from the downstream auto-run pipeline entirely (design.md has the rationale).
- Add a computed `aria-busy` pending affordance; keep the existing rollback error association
  (`aria-invalid`/`aria-describedby`), verified against the running app in both themes.
- Rollback stays scoped to a failed submit request (reject/network) only — a downstream run failure
  or guard/gate denial never rolls back a write that already persisted.

## Capabilities

### New Capabilities

- `dataset-field-aggregate`: read-only, ACL-scoped backend query for a numeric field's aggregate
  (sum of `delta`) across a dataset source's rows.

### Modified Capabilities

- `form-panel-submit`: the counter's immediate-submit path gains a pending affordance and a
  post-success reconciliation step against the new aggregate.

## Impact

- Backend: new route, service/repository method, `schemas/`+`openspec/` docs.
- Frontend: `FormPanelView.tsx`/`useFormPanelValues.ts` gain pending/reconcile state; `CounterControl`
  gains computed `aria-busy`.
- No new migration.

## Non-goals

- Raising the 500-row dataset cap (HEL-1133) or surfacing denial reasons (HEL-1096).
- Changing Output-bound panel refresh (`panel-run-refresh`/HEL-1094 is untouched).
