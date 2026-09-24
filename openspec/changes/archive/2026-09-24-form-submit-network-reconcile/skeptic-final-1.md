## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

All verification below is fresh, run by me in this session, against `WORKTREE_PATH`, HEAD =
`fec0a11458723464b17ef490843554ddaca9dcb9` (matches the ticket's stated commit). Base resolved live
via `resolve-review-base.sh` = `e1bf04b50b36648c36606cbcd876d967655a1f0c` (current `origin/main`
tip, not a cached/hand-typed ref).

1. **`reconcileValue`/`setValue` split is real, not just present.** Read
   `useFormPanelValues.ts:125-133` (`setValue`, unchanged — clears `externalErrorsState` for the
   field on every call) and `:164-166` (`reconcileValue`, new — only `setValues(...)`, never
   touches `externalErrorsState`). Read `FormPanelView.tsx:180-214`'s `reconciliationTail` — its
   one value-apply site (`:208`) calls `values.reconcileValue(...)`; grepped the whole file for
   `setValue(` — the only remaining call is inside `handleSubmit`'s standard multi-field path
   (`onChange={(v) => values.setValue(...)}`), unrelated to the counter reconcile path. Confirmed
   with a fresh test run: `useFormPanelValues.test.ts`'s new case (`setExternalErrors` then
   `reconcileValue`, asserts the error survives and the value updates) passes.

2. **Reconciliation-tail is called unconditionally from all three branches.** Read
   `FormPanelView.tsx:216-263`: `await reconciliationTail()` from the success branch (no
   callback), `await reconciliationTail()` from the definite-rejection branch (no callback), and
   `await reconciliationTail(() => setAlertText(...))` from the indeterminate branch — three call
   sites, one shared helper, unconditional in every branch's control flow (no early return skips
   it).

3. **"Couldn't confirm" fires only from the indeterminate branch's own trailing-fetch failure.**
   Confirmed by code read (only the indeterminate branch passes a non-empty `onReconcileFailed`)
   and by two targeted fresh test runs: `HEL-1169 2.4` (indeterminate settle whose own fetch also
   fails → announces "couldn't confirm") and `HEL-1169 2.5` (a rejection's fetch failure, then a
   *success* whose own trailing fetch also fails → no "couldn't confirm" announced, error cleared
   unconditionally instead per D3). Both pass.

4. **tasks.md Section 3a's accepted limitation was not silently fixed with cross-branch state.**
   `grep -n useRef FormPanelView.tsx` on HEAD and on the base commit both return the identical
   5 refs (`pendingFocusRef`, `formRef`, `submitButtonRef`, `pendingDeltasRef`,
   `reconcileGenerationRef`) — no new "did this burst see an indeterminate settle" tracking ref was
   added, matching the tasks.md instruction not to add one.

5. **Acceptance criteria, independently traced:**
   - AC #1 (definite rejection rolls back + `aria-invalid`/`aria-describedby`): traced through
     `FormPanelView.tsx` → `values.setExternalErrors({[field.sourceField]: message})` →
     `useFormPanelValues.ts`'s `errors` map → `FormFieldControl.tsx`'s `invalid`/`describedBy` →
     `CounterControl.tsx`'s `aria-invalid`/`aria-describedby` props. Confirmed live in the browser
     (below), not just via jsdom.
   - AC #2 (indeterminate does not roll back, reconciles, announces "couldn't confirm" only if the
     refetch also fails): traced through the indeterminate branch's absence of any
     `adjustNumericValue`/rollback call, plus point 3 above.
   - AC #3 (red-test-first evidence for the lost-ack-after-commit scenario): **independently
     reproduced, not merely trusted.** I temporarily swapped `FormPanelView.tsx` and
     `useFormPanelValues.ts` back to the base commit's content (`classifySubmitFailure.ts` stayed,
     since the base file doesn't import it) and re-ran
     `npm test -- --testPathPatterns="FormPanelView.test"`: **8 tests failed against pre-fix code,
     including `HEL-1169 1.1` and `HEL-1169 1.2` by name** — `1.1` failed on exactly the claimed
     symptom (expected `aria-valuenow="5"`, observed `"0"`, i.e. the persisted write got rolled
     back). Restored the fixed files (`git status --short` afterward showed no diff on those two
     files) and re-ran — 33/33 pass. This is the single most load-bearing check in this review and
     I did not take the executor's/evaluator's word for it.

6. **HEL-1096 `deniedPipelines` toast handling is unaffected.** `pushDenialToastIfAny`'s
   definition and its two call sites are byte-identical before/after in the diff (only line
   position moved via surrounding context, confirmed via `git diff -- FormPanelView.tsx | grep
   pushDenialToastIfAny`). No file under `frontend/src/features/pipelines/**` appears anywhere in
   the diff (`git diff --name-only ... | grep -i pipeline` → empty). Ran the HEL-1096 test suites
   fresh: `deniedPipelinesToast.test.ts`, `PipelineDetailFooter.denial.test.tsx`,
   `deniedPipelineToastA11y.test.tsx`, `denyReasonCopy.test.ts` — 34/34 pass.

7. **Fresh gate re-runs (not trusted from the evaluator's transcript):**
   - `npm test -- --testPathPatterns="FormPanelView|useFormPanelValues|classifySubmitFailure"` →
     48/48 pass.
   - `npm run lint` → clean, zero warnings.
   - `npm run typecheck` → clean.
   - `npm run build` → succeeds (same pre-existing >500kB chunk-size warning noted by the
     evaluator, unrelated to this diff).
   - `npx playwright test e2e/hel1169-network-vs-rejection-reconcile-a11y.spec.ts` (run from the
     worktree root, real dev server on `:6601` + real backend on `:9508`, servers verified healthy
     via `assert-phase.sh servers`) → **4/4 pass**, independently confirming the evaluator's claim.
     Reviewed all 4 resulting screenshots directly (not just the pass/fail signal): the definite
     rejection state shows the counter rolled back to `0`, marked invalid (red value + red field
     error + shared alert, both reading "delta must be positive"); the indeterminate state shows
     the counter held at `5`, NOT marked invalid, with "Couldn't confirm the current value. It may
     not be up to date." — visually and textually distinct from the rejection state, in both light
     and dark theme. No new CSS was introduced by this diff (confirmed empty
     `git diff --stat -- 'frontend/**/*.css'`); the styling is 100% reused pre-existing
     `FormField`/`CounterControl`/alert-region infrastructure, so no new DESIGN.md-relevant surface
     to separately audit. The duplicate "delta must be positive" text (once as the field-level
     error, once in the shared alert region) is a pre-existing app-wide convention — confirmed by
     reading `handleSubmit`'s catch branch, which does the identical
     `setExternalErrors`+`setAlertText` double-set for the standard multi-field path — not a defect
     introduced here.

8. **D0's spec-delta hazard (byte-identical MODIFIED headers) is actually honored.** Diffed both
   MODIFIED requirement headers in the spec delta against `openspec/specs/form-panel-submit/spec.md`
   line-by-line — byte-identical, confirmed with `diff`, not eyeballed.

### Assessment of the two accepted design risks (asked to independently judge, not just note)

- **D1 — proxy-4xx-as-definite:** Correctly NOT a regression — every 4xx/5xx already rolled back
  unconditionally before this ticket; this ticket narrows that to `err.response !== undefined`,
  which is a strict improvement (indeterminate failures no longer roll back at all) with no
  reliable client-side signal available to do better for the proxy case specifically. Reasonable
  to ship as-is.
- **D4a — three-way compound mixed-burst limitation:** Narrow (requires an indeterminate settle +
  a same-burst settle of a different kind that empties the pending set + that settle's own
  trailing fetch also failing, all three at once), never loses or misrepresents the write (stays
  in its accurate optimistic state), and self-heals on the very next click's own reconciliation
  invocation. Given this exact class of cross-branch interaction has already produced two prior
  design-gate rounds of real bugs (D3a, D4), adding a fourth piece of shared mutable state to close
  this specific edge case is a worse risk/reward trade than documenting it. Reasonable to ship
  as-is for a release-blocker ticket whose primary purpose is fixing the far more common
  indeterminate-vs-rejection conflation.

Neither risk should block delivery.

### Verdict: CONFIRM

No Change Requests. The implementation is correct, thoroughly tested (including an
independently-reproduced red-before-fix proof for the primary bug), and the two accepted design
risks are reasonable trade-offs, not oversights.

### Non-blocking notes
- Agree with the evaluator's non-blocking note: the PR description should name HEL-1170 explicitly
  as the tracked follow-up satisfying CONTRIBUTING.md's "propose a split" convention now that
  `FormPanelView.tsx` is at 442 lines.
- tasks.md 4.1 (filing the standalone idempotency-key follow-up) is still unchecked, correctly left
  to the orchestrator's Delivery phase — flagging only so it isn't dropped before this run's
  Delivery step runs.
