- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — `handleImmediateStep`'s catch branch
  now classifies via `isDefiniteRejection`; extracted the shared, unconditional
  `reconciliationTail` helper (design.md D2) called from all three settle branches
  (success/definite/indeterminate); definite rejection now also calls
  `values.setExternalErrors` (design.md D3); success now clears `externalErrors`
  unconditionally; indeterminate no longer rolls back and announces "couldn't confirm" only
  when its own trailing reconciliation fetch also fails (design.md D4).
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — added `reconcileValue`
  (design.md D3a): applies a fetched aggregate without touching `externalErrors`, unlike
  `setValue`.
- `frontend/src/features/panels/state/classifySubmitFailure.ts` — new pure classification
  helper, `isDefiniteRejection` (design.md D1): true for any Axios error carrying
  `err.response`, false otherwise.
- `frontend/src/features/panels/state/classifySubmitFailure.test.ts` — new unit tests for the
  classification helper.
- `frontend/src/features/panels/ui/form/useFormPanelValues.test.ts` — added a test for
  `reconcileValue` not clearing `externalErrors` (task 2.0).
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — added tasks.md Section 1
  red-first tests (1.1 lost-ack-after-commit, 1.2 definite-rejection ARIA) plus Section 2
  tests (2.4 refetch-also-fails, 2.5 success-clears-error, 2.6 mixed-outcome-burst, 2.8
  primary-path regression). Updated 3 pre-existing tests (`1.3/4.3`, `3.2`, `3.7`) that used a
  response-less `Error` to simulate "a rejected click" — under the new classification a
  response-less failure is indeterminate and must NOT roll back, so these were switched to a
  definite (axios) rejection to preserve their original intent; `3.7` additionally updated its
  final assertions because design.md D2 now makes the shared reconciliation tail fire
  unconditionally on every settle kind, including the rejection that previously never
  reconciled at all.
- `e2e/hel1169-network-vs-rejection-reconcile-a11y.spec.ts` — new live-browser a11y spec
  (tasks.md 3.3), mirroring `hel1095-optimistic-pending-writing-panel-a11y.spec.ts`'s harness:
  a definite (400) rejection vs. an indeterminate failure whose reconciliation also fails,
  proven visually/textually distinct in both light and dark theme against the running app;
  also proves a definite rejection's `aria-invalid` survives its own successful trailing
  reconciliation fetch. 4/4 passing against the real dev+backend servers.
- `openspec/changes/form-submit-network-reconcile/tasks.md` — checkboxes marked complete
  (task 4.1, filing the Linear follow-up, is explicitly the orchestrator's job at Delivery —
  left unchecked here).

## Root cause (systematic-debugging evidence)

- **Root cause:** `FormPanelView.tsx`'s `handleImmediateStep` catch branch treated every submit
  failure identically (a definite server rejection and a response-less network failure alike),
  always subtracting the click's own delta — so a network failure that occurred AFTER the
  server had already committed the write rolled back a value that was actually correct.
- **Probe:** added task 1.1's test (`FormPanelView.test.tsx`, "HEL-1169 1.1") — mocks
  `submitFormPanel` rejecting with a response-less `Error` while `fetchFieldAggregate` (the
  server's own authoritative total) already reflects the committed write — and ran it against
  the pre-fix code.
- **Probe output:** `npm test -- --testPathPatterns=FormPanelView` failed 2 tests
  (`HEL-1169 1.1`, `HEL-1169 1.2`) against the original code — `1.1` expected
  `aria-valuenow="5"` (the persisted total) but observed `"0"` (the rolled-back value),
  confirming the hypothesis before any implementation edit.
