## Context

`FormPanelView.tsx`'s `handleImmediateStep` (the compact counter's `+`/`-` handler) already has a
quiesce-gated reconciliation mechanism from HEL-1095: once every in-flight request in a click burst has
settled, it fetches the dataset's authoritative aggregate (`GET /api/data-sources/:id/rows/aggregate`)
and replaces the optimistic tally with it — but only on the SUCCESS path. The `catch` branch treats
every rejection identically: it always subtracts the click's own delta (a relative rollback, correct
per-click even with siblings in flight) and always shows a generic/field-error message. It never
distinguishes "the server said no" from "we don't know what happened." See proposal.md - Why for the
production consequence (HEL-1169).

## Goals / Non-Goals

**Goals:**
- Split the `catch` branch's single behavior into two, keyed on whether the error carries an HTTP
  response.
- Reuse the existing reconciliation fetch (and its generation/pending-set staleness guards) for the
  indeterminate path instead of building a second, parallel mechanism.
- Associate a definite rejection's error with the counter control itself (`aria-invalid`/
  `aria-describedby`), matching what the non-counter `handleSubmit` path already does via
  `values.setExternalErrors`.
- Keep "reconcile the displayed TOTAL" and "manage the field's ERROR state" fully independent at the
  implementation level (not merely in intent) — a value-reconciliation fetch must never incidentally
  clear or overwrite an error a settle itself has set (see D3a).

**Non-Goals:**
- An idempotency key for counter row-appends. No client-side retry exists today (confirmed:
  `httpClient.ts` has no retry interceptor), so a lost-ack scenario only double-counts if the USER
  manually re-clicks after seeing the (now-corrected) reconciled value — a pre-existing risk this
  ticket does not change the odds of. Filed as a standalone follow-up per the "Non-goals" constraint
  agreed at Planning (workflow-state.md constraint C3).
- Changing `handleSubmit` (the non-counter, whole-form path) — it never applies an optimistic value
  before the response, so there is nothing to roll back or reconcile there.
- HEL-1170's broader refactor of `handleImmediateStep`'s structure — orthogonal, tracked separately.

## Decisions

**D0 — Spec-delta MODIFIED requirement headers are kept byte-identical to the base spec.**
Round-1 design-gate review (skeptic, CR1) found that `openspec archive`'s MODIFIED-requirement matching
is an exact-string match against the base spec's requirement header (no fuzzy/near-miss fallback —
confirmed by reading the OpenSpec CLI's `specs-apply.js`), and this change's spec delta had renamed a
requirement's title while using `## MODIFIED Requirements` instead of `## RENAMED Requirements` —
archive would have thrown `MODIFIED failed for header "..." - not found` at delivery time, after all
code and tests were already done. Fixed: every MODIFIED requirement in the spec delta keeps its header
text byte-identical to `openspec/specs/form-panel-submit/spec.md`; the "definite rejection" narrowing
and the broadened reconciliation trigger are both expressed in the requirement BODY and scenarios only,
never the title.

**D1 — Classification: presence of `err.response`, not status-code range.**
A submit's rejection is **definite** when `isAxiosError(err) && err.response !== undefined` — true for
any 4xx or 5xx, including one relayed by an intermediate proxy (502/503/504), since axios still
populates `err.response` with whatever status/body the proxy returned. It is **indeterminate** when
`err.response` is `undefined` — a genuine network error, timeout, CORS block, or aborted request, where
no HTTP exchange with any server (origin or proxy) completed at all.

This is the classification the ticket's own AC #1 already specifies ("4xx/5xx with a body" is definite)
and matches the codebase's existing idiom for this exact check (`panelService.ts`'s
`parseFieldErrors`, `classifyRequestError.ts`, `httpClient.ts`'s 401 interceptor — all branch on
`err.response` presence, never on the numeric status value, to distinguish "the server answered" from
"nothing came back"). Considered and rejected: treating a 5xx specially as indeterminate on the theory
"a proxy 502 might mean the write happened." Rejected because axios's `err.response` boundary already
IS the "did anything answer" signal — a 502 with a body is still a response, from something, and the
alternative (guessing from status code alone whether a response "really" reached the origin) has no
reliable signal to key on client-side. This reading was cross-checked against the ticket AC text at
Setup/Planning (orchestrator premise validation) rather than escalated, since the AC already resolves
it explicitly; flagged to the human in the delivery summary for a sanity check regardless, since it's
the one place this design makes a judgment call beyond what's textually unambiguous.

**D2 — Every settle calls the same shared reconcile-tail helper, unconditionally (three call sites,
not two).**
Round-1 design-gate review (skeptic, design gate round 1, CR2) found a real correctness gap: scoping
the reconcile-tail helper to only the success and indeterminate branches means a burst that happens to
*quiesce on a definite-rejection settle* never reconciles — even when an earlier sibling in the same
burst was indeterminate and genuinely needs correcting. Fixed by making the reconcile-tail
unconditional: every settle — success, definite rejection, or indeterminate alike — performs the SAME
steps (delete token, bump `reconcileGenerationRef`, and — only if the pending map is now empty — fetch
the aggregate under the same `myGen`/pending-set-empty staleness check before applying it), as a shared
helper called from all three branches, not two. This is still a refactor-shaped consolidation (extract
the existing success-path reconciliation block into a helper every branch calls) rather than new
state-machine design — the existing scenarios in `form-panel-submit`'s "Rapid immediate-submit
activations accumulate optimistically..." requirement (quiesce timing, staleness discard, out-of-order
settling) already prove correct and are unaffected structurally; they just gain two more callers. A
definite rejection's own immediate relative-delta rollback happens first, before the shared tail runs —
the tail's later aggregate fetch (once quiesced) then either reconfirms that corrected value or, in a
mixed burst, corrects for a sibling's indeterminate outcome the rejection branch alone could never see.
This is captured in the spec delta as a MODIFIED requirement (not a new ADDED one) against the base
spec's existing "A counter's displayed value reconciles..." requirement, broadening its trigger from
"a successful submit" to "the pending burst quiescing, regardless of settle-kind mix" — kept as a
MODIFIED entry with the header held byte-identical to the base spec (see D0 below) rather than an
ADDED requirement that would silently contradict the still-standing base text.

**D3 — A definite rejection now also calls `values.setExternalErrors`, and success explicitly clears it.**
Mirrors `handleSubmit`'s existing pattern (`mapServerFieldErrors` → `setExternalErrors`) so the counter
control gets the same `aria-invalid`/`aria-describedby` association a standard field already gets on
rejection. Since the compact counter has exactly one field, this is a single-entry map keyed by
`field.sourceField`, using `parseFieldErrors(err)` when the response carries structured field errors,
falling back to a generic per-field message otherwise (so the control is still marked invalid even for
a 5xx with no `fieldErrors` body) — never left unassociated the way it is today.

Round-1 design-gate review (skeptic, CR3) found that introducing `setExternalErrors` here with no
explicit clearing plan is fragile: `useFormPanelValues.ts`'s `adjustNumericValue` (called on every
click, including the very next one after a rejection) does NOT clear `externalErrors`, and the only
existing clear path (`setValue`, called inside the reconciliation success branch) only runs when that
settle both empties the pending map AND its own aggregate fetch succeeds — so a stale `aria-invalid`
could survive indefinitely across a later successful click whose own reconciliation fetch happens to
fail. Fixed: the success branch calls `values.setExternalErrors({})` **unconditionally** on every
successful settle, independent of whether that settle's own reconciliation fetch succeeds — mirroring
`handleSubmit`'s explicit `values.setExternalErrors({})` on success (line 267) exactly, rather than
relying on `setValue`'s incidental clearing as a side effect of a fetch that might not even run.

**D3a — `useFormPanelValues` gains a `reconcileValue` primitive, distinct from `setValue`, that never
touches `externalErrors`.**
Round-2 design-gate review (skeptic, CR1) found that D2 (every settle calls the shared reconcile-tail
unconditionally) and D3 (a definite rejection calls `setExternalErrors`) collide via `setValue`'s
existing, unmodified side effect: `useFormPanelValues.ts:118-126` shows `setValue` unconditionally
deletes `externalErrors[sourceField]` whenever called. Since `values.setValue(...)` was the ONLY
existing mechanism to apply a fetched aggregate (`FormPanelView.tsx:200-202`), and D2 now calls the
reconcile-tail even from the definite-rejection branch, the walked sequence for the single most common
case — an isolated rejected click, no sibling in flight — was: rollback → `setExternalErrors(...)` sets
`aria-invalid` → reconcile-tail's aggregate GET succeeds (a separate, normally-healthy endpoint) →
`values.setValue(...)` silently clears `externalErrors` on that SAME settle, defeating AC #1 in the
primary path, not an edge case.

Fixed: `useFormPanelValues.ts` gains a new function, `reconcileValue(sourceField, value)`, with the
SAME value-setting body as `setValue` (`setValues((prev) => ({ ...prev, [sourceField]: value }))`) but
which does **not** touch `externalErrorsState` at all — no clearing side effect. `setValue` remains
unchanged (still clears on a genuine user-driven edit, which is correct — a user actively re-entering a
field should invalidate a stale server verdict for it, per its existing doc comment). The reconcile-tail
helper (D2) uses `reconcileValue`, never `setValue`, to apply a fetched aggregate on ALL THREE branches
— so applying the reconciled TOTAL can never, on any branch, incidentally clear a field-associated
ERROR any branch has set. This makes D2's own claim ("the two are independent") actually true at the
implementation level, not just asserted in prose. `handleSubmit`'s whole-form path is unaffected — it
has no counter/reconcile-tail concept and keeps calling `setValue` exactly as today.

**D4 — A reconciliation fetch's own failure announces "couldn't confirm" — but ONLY when the settle
that triggered it was itself indeterminate.**
Round-2 design-gate review (skeptic, CR2) found the original D4 text ("when the reconciliation fetch
itself fails...") was unscoped by which settle triggered the tail, which — once D2 made the tail
unconditional across all three branches — created two further conflicts: (a) it would silently change
the SUCCESS path's existing, accepted behavior (a failed post-success refetch is swallowed silently
today, `FormPanelView.tsx:203-209`'s own comment: "left as-is rather than surfacing a spurious error for
a persisted write" — task 2.1 explicitly claims no behavior change there), and (b) it would let a
definite-rejection settle's own trailing fetch failure overwrite that rejection's own specific,
already-announced error text with a generic "couldn't confirm" message — misrepresenting what actually
happened, in the same conflation direction this ticket exists to fix, just reversed.

Fixed, precisely: the reconcile-tail helper's caller (not the helper itself) owns whether a fetch
failure is surfaced. Only the **indeterminate** branch passes an `onReconcileFailed` callback (or
equivalent) that sets the assertive region to the "couldn't confirm" text; the success and
definite-rejection branches call the SAME shared tail helper but pass nothing for that case, so a
failure there stays silent — success exactly as today, and a definite rejection's own error message
stays displayed, untouched. Reuses the assertive `role="alert"` region (no new live region) for the one
case that does announce.

**D4a — Accepted limitation: a mixed burst that quiesces on a non-indeterminate settle, whose own
trailing fetch then also fails, does not announce the earlier indeterminate sibling as unconfirmed.**
Round-3 design-gate review (skeptic, CR1) found that D4's per-branch `onReconcileFailed` ownership has
no way to know a DIFFERENT settle within the same quiesced burst was the indeterminate one: e.g. click A
settles indeterminate first (sibling B still pending, so A's own invocation doesn't fetch), click B
settles with a definite rejection second and empties the pending set — B's branch correctly passes no
`onReconcileFailed` (so B's own rejection text isn't overwritten), but if that trailing fetch then
fails, A's indeterminate write is neither corrected nor ever announced as unconfirmed. This requires a
COMPOUND failure — an indeterminate settle, a same-burst rejection (or success) settle that empties the
set, AND that settle's own trailing fetch also failing — all three at once. Accepted as a documented
limitation rather than fixed with burst-level cross-branch state (e.g. a ref flag tracking "did this
burst contain an indeterminate settle," read by whichever branch's own invocation ultimately fires):
the write itself is never lost or misrepresented as failed (it stays in its optimistic state, exactly
as accurate as it was before this settle), and it self-heals on the very next click's own tail
invocation, which will retry the same reconciliation fetch. Given this change has already required two
prior rounds of revision from exactly this class of cross-branch state interaction, adding a fourth
piece of shared mutable state to close a narrow, three-way-compound edge case was judged a worse
risk/reward trade than documenting it — mirroring the existing accepted proxy-4xx risk below in both
pattern and rationale.

## Risks / Trade-offs

- [Risk] A mixed burst containing an indeterminate settle that quiesces on a DIFFERENT (success or
  definite-rejection) settle, whose own trailing reconciliation fetch then ALSO fails, does not surface
  a "couldn't confirm" announcement for the indeterminate sibling specifically (D4a) — a three-way
  compound failure. → Mitigation: the write is never lost or rolled back; the next click's own
  reconcile-tail invocation retries the same fetch and self-heals. Accepted rather than adding
  cross-branch shared state to a mechanism that has already required two prior rounds of revision from
  exactly this class of interaction.
- [Risk] A 4xx/5xx that is genuinely a proxy artifact (the origin never saw the request) is still
  treated as definite and rolls back a write that never happened — but this is the status quo today for
  EVERY 4xx/5xx, and per D1 there is no reliable client-side signal to do better; not a regression.
  → Mitigation: none needed beyond D1's classification; flagged in the delivery summary as a known,
    accepted limitation rather than silently assumed.
- [Risk] A user who sees a "couldn't confirm" state and manually retries after the reconciliation
  fetch quietly succeeds (no user-visible signal distinguishes "confirmed via reconcile" from "still
  showing the optimistic value") could double-submit. → Mitigation: out of scope (see Non-Goals); the
  reconcile fetch's SUCCESS path already replaces the value with the true total, so a retry after a
  successful reconcile double-counts no more than any other unprotected re-click today. Filed as a
  follow-up ticket for the idempotency-key question rather than addressed here.

## Migration Plan

No data migration. Pure frontend behavior change behind existing endpoints; no feature flag needed
(strictly corrects a mis-scoped rollback condition per the owner's already-recorded HEL-1095 ruling).
Rollback: revert the commit; no persisted-state implications.
