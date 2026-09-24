## 1. Red tests first (systematic-debugging: prove the defect before fixing it)

- [x] 1.1 Add a lost-ack-after-commit test to `FormPanelView.test.tsx`: the mock submit rejects with a
      response-less error (network failure) AFTER the mocked server has "committed" (the aggregate mock
      reflects the new total), and assert the final displayed value equals the persisted aggregate, not
      the rolled-back value. Run it against today's `main` code first and confirm it is RED (fails),
      captured as evidence before any implementation edit.
- [x] 1.2 Add a definite-rejection test: a mocked 4xx (with `fieldErrors`) still rolls back by exactly
      the click's own delta, AND asserts computed `aria-invalid="true"` / `aria-describedby` resolving to
      the error text on the counter control (not just alert-region text) — this half is also RED today
      (the aria association doesn't exist yet), confirm and capture.

## 2. Implementation

- [x] 2.0 Add `reconcileValue(sourceField, value)` to `useFormPanelValues.ts`: same value-setting body as
      `setValue` (`setValues((prev) => ({ ...prev, [sourceField]: value }))`) but does NOT touch
      `externalErrorsState` at all (design.md D3a, fixing round-2 design-gate CR1 — `setValue`'s
      unconditional `externalErrors` clear must never fire as a side effect of applying a reconciled
      aggregate). `setValue` itself is unchanged. Verify: a unit test on the hook directly — call
      `setExternalErrors({f: "err"})` then `reconcileValue("f", "5")`, assert `errors.f` is still `"err"`
      and `values.f` is now `"5"`.
- [x] 2.1 Extract the reconciliation-tail block (delete token, bump generation, quiesce-gated aggregate
      fetch + staleness-guarded apply via `reconcileValue` from 2.0, NEVER `setValue`) in
      `handleImmediateStep` into a shared helper, called UNCONDITIONALLY from all THREE branches —
      success, definite rejection, and indeterminate failure alike (design.md D2, fixing round-1
      design-gate CR2: a burst that quiesces on a definite-rejection settle must still reconcile an
      earlier sibling's indeterminate outcome). The helper accepts an optional `onReconcileFailed`
      callback, invoked only when this settle emptied the pending map AND the aggregate fetch itself
      failed (design.md D4, fixing round-2 design-gate CR2) — the caller decides whether to surface
      anything, the helper itself never does. Verify by reading the diff: no behavior change to the
      existing success path, confirmed by the pre-existing reconciliation test suite still passing
      unmodified, PLUS a new mixed-outcome-burst test (2.6).
- [x] 2.2 Classify the `catch` branch's error via `isAxiosError(err) && err.response !== undefined`
      (definite) vs. otherwise (indeterminate) — verify via 1.1/1.2 now passing.
- [x] 2.3 Definite branch: keep the existing relative rollback, additionally call
      `values.setExternalErrors({ [field.sourceField]: <message> })` using `parseFieldErrors(err)` when
      present (falling back to a generic per-field message otherwise), THEN call the shared
      reconciliation-tail helper from 2.1 with NO `onReconcileFailed` callback (a failed trailing fetch
      here stays silent — the rejection's own error text must not be overwritten) — verify via 1.2's aria
      assertions passing AND the new same-settle-reconcile-doesn't-clear test (2.8).
- [x] 2.4 Indeterminate branch: do NOT roll back; call the shared reconciliation-tail helper from 2.1
      WITH an `onReconcileFailed` callback that announces a "couldn't confirm" assertive message distinct
      from the rejection wording, leaving the optimistic value untouched — verify via 1.1 passing plus a
      new refetch-also-fails test.
- [x] 2.5 Success branch: call `values.setExternalErrors({})` UNCONDITIONALLY (independent of whether the
      shared reconciliation-tail's own fetch succeeds) to clear any stale rejection error from a prior
      click (design.md D3, fixing round-1 design-gate CR3) — verify with a test: reject once (control
      marked invalid), then succeed once, and assert `aria-invalid` is no longer `"true"` after the
      success settles, even when that success's own reconciliation fetch is mocked to fail. Also verify a
      failed trailing fetch on THIS branch produces no "couldn't confirm" announcement (no
      `onReconcileFailed` passed here either) — existing accepted silent-swallow behavior, unchanged.
- [x] 2.6 Add the mixed-outcome-burst test the spec delta's new scenario requires: click A settles
      indeterminate first (sibling still pending), click B settles with a definite rejection second
      (empties the pending set) — assert the reconciliation fetch still fires on B's settle and the
      final displayed value reflects the dataset's true aggregate.
- [x] 2.7 Verify `pushDenialToastIfAny`/HEL-1096 `deniedPipelines` handling is untouched on every path —
      run the existing HEL-1096 tests unmodified and confirm they still pass.
- [x] 2.8 Add the PRIMARY-PATH regression test round-2 design-gate CR1 requires: a single rejected click,
      no sibling in flight, whose own trailing reconciliation fetch SUCCEEDS — assert `aria-invalid` is
      still `"true"` and `aria-describedby` still resolves to the error text after that fetch resolves
      (i.e. the reconcile-tail's `reconcileValue` call did not clear the error `setExternalErrors` just
      set on the same settle). This is the single most common real-world path for AC #1 and must be
      explicitly covered, not left implicit in 1.2.

## 3. Verification gates

- [x] 3.1 `npm test -- --testPathPatterns=FormPanelView` — full suite green, including both red tests
      from Section 1 and the primary-path regression test (2.8) now passing.
- [x] 3.2 `npm run lint` and `npm run typecheck` — zero warnings/errors.
- [x] 3.3 Visual/manual check: run the dev app, drive a real counter click with the backend killed
      mid-request (indeterminate) and again with a live backend + a forced 400 (definite) — compare
      against DESIGN.md in both light and dark theme; confirm the two error states are visually and
      textually distinguishable, and confirm the 400 case's error stays visible after the trailing
      reconciliation fetch resolves (not just in a mocked test).

## 3a. Documented, accepted limitation (do not implement)

- [x] 3a.1 No code task here by design (design.md D4a, Risks) — a mixed burst that quiesces on a
      non-indeterminate settle whose own trailing reconciliation fetch also fails does not announce the
      earlier indeterminate sibling as unconfirmed (a three-way compound failure: indeterminate settle +
      same-burst non-indeterminate settle emptying the set + that settle's own fetch failing). Accepted
      as documented in design.md rather than fixed with cross-branch shared state. Do not add a
      burst-level "had indeterminate settle" tracking ref for this ticket.

## 4. Follow-ups (do not implement here)

- [ ] 4.1 File a standalone Linear follow-up for the pre-existing lost-ack + manual-re-click
      double-count risk (no idempotency key on counter row-appends) — `origin_kind: followup`,
      `origin_ticket: HEL-1169`, `Follow-up` label, relatedTo HEL-1169, v0.8 project
      `28f119e2-5738-46b1-a53b-42f73e06b053`. Do not implement an idempotency key in this change.

## Standing Constraints

- [C1] Migration ledger: V110 is highest landed Flyway migration; V111 is the next free version number
      if this ticket needs one. (This ticket is not expected to need a migration — no schema change.)
- [C2] HEL-1170 (separate Low refactor of `FormPanelView.tsx`'s `handleImmediateStep`) is explicitly out
      of scope for this ticket — do not fold in.
- [C3] An idempotency key for counter row-appends is out of scope for this ticket — file as a standalone
      follow-up rather than widening scope (see Section 4).
