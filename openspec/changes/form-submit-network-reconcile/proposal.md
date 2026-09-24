## Why

The counter/form submit path (`FormPanelView.tsx`'s `handleImmediateStep`) rolls back its optimistic value on
ANY submit failure — a server rejection and a transport-level network failure alike. When the network failure
happens after the server has already committed the write (a lost acknowledgement), the rollback reverts a value
that is actually correct, so the panel disagrees with the dataset. The owner's HEL-1095 ruling — "only a failed
submit rolls back" — means a committed write is not a failed submit; this was recorded as a known gap in
HEL-1095's own design.md Risks section and is now a v0.8.4 release blocker (HEL-1169).

## What Changes

- Classify a counter submit's failure as **definite** (an HTTP response was received — any 4xx/5xx, since even a
  proxy error carries a response) or **indeterminate** (no response at all: network error, timeout, abort).
- A definite rejection keeps today's rollback behavior, and additionally associates the error with the counter
  control itself via `aria-invalid`/`aria-describedby` (today only the shared alert region announces text).
- An indeterminate outcome no longer rolls back. Instead it refetches the dataset's authoritative aggregate
  (the same endpoint the success path already reconciles against) and replaces the optimistic value with the
  true total. If that refetch also fails, the optimistic value is kept and an assertive "couldn't confirm"
  state is announced rather than silently leaving an unconfirmed value with no indication.
- The existing multi-click quiesce/generation-guarded reconciliation machinery (HEL-1095) is reused, not
  replaced: an indeterminate settle still only triggers its own reconciliation attempt once the whole pending
  burst quiesces, exactly like a successful settle does today.
- HEL-1096's `deniedPipelines` toast (`pushDenialToastIfAny`) is unaffected on every path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `form-panel-submit`: the "counter's optimistic rollback is scoped to its own submit-request failure only"
  requirement is narrowed to definite rejections only (also now field-associated); the "counter's displayed
  value reconciles..." requirement is MODIFIED (not new) to broaden its trigger from "after a successful
  submit" to "once the pending burst quiesces, regardless of settle-kind mix."

## Impact

- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — `handleImmediateStep`'s catch branch.
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — new `reconcileValue` primitive
  (applies a reconciled value without clearing `externalErrors`, unlike `setValue`).
- New pure classification helper (definite vs. indeterminate), colocated with the view or in
  `frontend/src/features/panels/state/` — reused by both the classification decision and its test.
- Test additions: `FormPanelView.test.tsx` — a lost-ack-after-commit case (red against today's behavior first),
  a definite-rejection-still-rolls-back case with computed ARIA assertions, and a refetch-also-fails case.
- No backend change: `GET /api/data-sources/:id/rows/aggregate` (HEL-1095) is reused as-is.
- No schema/migration change.

## Non-goals

- An idempotency key for counter row-appends (lost-ack + user re-click double-counting) — pre-existing,
  out of scope; filed as a standalone follow-up.
- HEL-1170's broader refactor of `handleImmediateStep` — separate, unrelated ticket; not folded in here.
- The non-counter, whole-form `handleSubmit` path has no optimistic value to roll back (it never
  speculatively applies a value before the response) — out of scope, unaffected.
