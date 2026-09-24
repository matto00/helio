## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Spawn-cwd guard** — `pwd -P` → `/home/matt/Development/helio`;
   `scripts/concertino/assert-cwd.sh` returned
   `READY ambient=/home/matt/Development/helio branch=bug/form-submit-rollback-network-vs-rejection/HEL-1169`.
   Proceeded.

2. **No code has landed yet** — `git status --short` shows only the untracked
   `openspec/changes/form-submit-network-reconcile/` dir; `git diff main...HEAD --stat` is empty. Correct
   for a design-gate review: nothing here beyond planning artifacts.

3. **Round-2 CR1 (`setValue`/`setExternalErrors` collision on the primary AC #1 path) is genuinely
   closed at the implementation-plan level, not just in prose.** Read the current
   `useFormPanelValues.ts:118-126` directly — confirmed `setValue` still unconditionally deletes
   `externalErrors[sourceField]` as a side effect (unmodified, as design.md D3a claims). Read
   design.md D3a and tasks.md 2.0/2.1/2.3 and walked the exact primary-path sequence myself:
   - Rollback: `adjustNumericValue(field.sourceField, -delta)`.
   - `values.setExternalErrors({ [field.sourceField]: message })` → `aria-invalid="true"`.
   - Shared reconcile-tail (no sibling in flight → fetches immediately): on success, applies via
     **`reconcileValue(field.sourceField, String(aggregate.value))`** — per tasks.md 2.0, this has
     "the SAME value-setting body as `setValue`... but does NOT touch `externalErrorsState` at all."
   - Result: `values` is updated to the true aggregate; `externalErrors[field.sourceField]` is left
     untouched. `aria-invalid` stays `"true"` through the same settle. This is exactly the primary
     AC #1 case round 2 found broken, and it is now correct as designed.
   - On a trailing-fetch failure on this same branch: task 2.3 passes no `onReconcileFailed`, so the
     failure stays silent and the rejection's own `alertText` is never overwritten — closing round
     2's second sub-finding (a rejection's own error being overwritten by a "couldn't confirm" text)
     too.
   - Confirmed via `grep` that `setValue` has exactly two call sites in the whole frontend
     (`FormPanelView.tsx:201` — the one being replaced by `reconcileValue` — and `FormPanelView.tsx:373`,
     the unrelated standard-field-list `onChange`, which the design correctly leaves untouched) and
     `useFormPanelValues` has no other consumer. So no other code path silently depends on `setValue`'s
     error-clearing side effect that a parallel `reconcileValue` path could now miss — verified by grep,
     not assumed.
   - Cross-checked against `useFormPanelValues.test.ts`: task 2.0's specified unit test ("call
     `setExternalErrors`, then `reconcileValue`, assert the error survives and the value updates") is
     the direct mirror of the file's existing "setValue clears that field's external error" test
     (line 111) — consistent with the file's established test idiom, not a bolt-on.
   **CR1 is closed**, verified at the sequence level against real, unmodified source, not the summary.

4. **Round-2 CR2 (`onReconcileFailed` scoping ambiguity) is now unambiguous in both design.md and
   tasks.md, and consistent with each other.** design.md D4 states plainly: only the indeterminate
   branch passes the callback; success and definite-rejection pass none. tasks.md 2.1/2.3/2.4/2.5 say
   the same thing in matching, non-contradictory language ("NO `onReconcileFailed` callback" / "with an
   `onReconcileFailed` callback" / "no `onReconcileFailed` passed here either"). The spec delta's body
   text is likewise now explicitly scoped ("Only when the settle that ultimately empties the pending
   set was itself an **indeterminate** failure... SHALL the... assertive region announce...") and gained
   three matching new scenarios (success-triggered silent, rejection-triggered silent-and-non-
   overwriting, indeterminate-triggered announces). No remaining ambiguity between the two documents.

5. **D0's byte-identical-header discipline still holds with the round-2/3 body and scenario text
   added.** Did not just trust the `openspec validate --strict` pass (which itself passed — `Change
   'form-submit-network-reconcile' is valid`). Independently re-ran the actual archive-matching code
   path myself (not reusing round 2's script, wrote my own): loaded `findSpecUpdates`/`buildUpdatedSpec`
   from `~/.local/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js` and ran them against
   this change dir. Result: `counts: {added: 0, modified: 2, removed: 0, renamed: 0}`, `warnings: []`,
   no exception. Also independently confirmed (reading `specs-apply.js:333-336`) there is a THIRD check
   beyond header match — `findMissingCurrentScenarios`, which throws if the base spec's requirement
   contains any scenario name the delta's MODIFIED block drops — and manually diffed the base spec's
   scenario names for both touched requirements (`Value reconciles after a successful submit with no
   downstream pipeline`, `...even when the auto-run gate denies`, `A rejected submit rolls back with a
   visible error`, `A rollback while a sibling click is still in flight...`, `A downstream run failure
   does not roll back...`) against the delta: all five are retained verbatim. This would also have
   thrown at archive time if dropped, and it does not.

### Change Requests

1. **New gap, not present in rounds 1-2: the "couldn't confirm" announcement's ownership is scoped to
   whichever settle happens to empty the pending set, not to whether the burst it belongs to contained
   an indeterminate outcome — so a mixed burst that quiesces on a non-indeterminate settle can leave an
   earlier sibling's indeterminate write both unconfirmed AND unannounced.**

   Walk design.md D2's own new scenario one step further than the design or tasks.md 2.6 take it: click
   A settles **indeterminate** first (sibling B still pending — tail from A's own branch doesn't fetch
   yet, map not empty); click B settles with a **definite rejection** second, emptying the pending set.
   Per task 2.3, B's branch calls the shared tail with **no** `onReconcileFailed` (by design — a
   rejection's own trailing-fetch failure must stay silent so it doesn't overwrite B's own error text).
   The fetch this tail dispatches is the ONLY reconciliation attempt for the whole burst, including A's
   indeterminate outcome — there is no separate "did any settle in this burst come back indeterminate"
   tracking. If that fetch **fails**:
   - No "couldn't confirm" announcement fires (B's branch passed no callback — correct per D4's own
     stated intent for B's own rejection).
   - A's indeterminate write is never corrected against the true aggregate (the fetch failed) and never
     announced as unconfirmed either (nothing tracks that A, not just B, was part of this settle).
   - The user sees only B's rejection error text; A's own write status is left in an ambiguous
     optimistic state with zero indication anything about it is unconfirmed.

   This is squarely in the territory AC #2 exists to close ("does NOT silently roll back... with an
   announced 'couldn't confirm' state if the refetch also fails") — the write isn't rolled back, but the
   "announced if refetch fails" half silently doesn't fire for A specifically, because the design's
   ownership model (D4: "the caller [i.e., whichever settle triggers the tail] decides") has no
   mechanism to know a DIFFERENT settle in the same quiesced burst was the indeterminate one. Task 2.6
   only tests the mixed-burst **success** path (the fetch succeeds); the mixed-burst **failure** path —
   the natural next case given 2.6 already exists — is untested and unaddressed by any design decision
   or Risks entry.

   This is a materially narrower case than rounds 1-2's findings (it requires a compound failure: an
   indeterminate settle AND a same-burst-terminating settle's own trailing-fetch also failing), and I
   am not asserting the fix must be a code change — design.md's Risks section already accepts one
   similarly-narrow, similarly-argued limitation (the proxy-4xx-treated-as-definite risk) explicitly and
   with a stated rationale. This one currently has no such entry; it is neither designed-around nor
   disclosed.

   **Required revision (either is sufficient):**
   (a) Add a Risk entry to design.md's Risks section explicitly naming this scenario and accepting it
   (matching the existing pattern for the proxy-artifact risk) — i.e., a conscious, disclosed choice
   rather than an unexamined gap; or
   (b) Track whether the burst-in-progress contains an indeterminate settle independent of which settle
   ultimately empties the pending set (e.g. a ref flag set by the indeterminate branch, read — and
   reset — by whichever branch's tail invocation actually dispatches the fetch) and pass
   `onReconcileFailed` from that trigger point whenever true, regardless of which branch triggered it.

### Non-blocking notes

- D1's classification rule (`err.response` presence) and its citation of `panelService.ts`/
  `classifyRequestError.ts` as the existing codebase idiom for this distinction is accurate — verified
  by grep against both files directly.
- `parseFieldErrors` (design.md D3, cited for the definite-rejection message) exists at
  `panelService.ts:183` and is already used in the current (unmodified) `handleImmediateStep` catch
  branch — the reuse claim is accurate, not aspirational.
- Tasks 1.1/1.2's red-before-green discipline, 2.6's mixed-burst-success coverage, 2.7's HEL-1096
  regression guard, and 2.8's explicit primary-path regression test are all well-specified and traceable
  to concrete spec scenarios.

### Verdict: REFUTE
