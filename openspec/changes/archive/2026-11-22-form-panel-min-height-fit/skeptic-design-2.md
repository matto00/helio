## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `cba523c030821c709ba227ab8c06a59f9ab913fc`. The change dir is untracked, and no code has changed yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
- **Code claims in design.md, checked against `frontend/src/features/panels/ui/form/FormPanelView.tsx`:**
  - The file is 481 lines (`wc -l`).
  - The non-owner quiesce branch, `if (pendingDeltasRef.current.size === 0 && !isFormOwner) { onReconcileFailed?.(); }`, is at lines 225-228.
  - `onReconciled` runs only on the owner's fetch branch, and only after the stale-generation check.
  - The success settle clears `externalErrors` unconditionally. The rejection settle sets `burstRejectedRef = true` and passes no callbacks. Only the indeterminate settle passes the two callbacks.
  - So the only stale path for a non-owner is a later burst that quiesces on an indeterminate settle. D2's "second callback on the non-owner branch, guarded by `burstRejectedRef`" targets exactly that path.
  - D2 issues no request, so it stays consistent with HEL-1784's "never reads the dataset" (`openspec/specs/form-panel-submit/spec.md:631-651`).
  - The new ADDED requirement says the error clears when "the burst quiesces with no rejection in it". That matches the implementation. A burst that quiesces on a success has already cleared the error, and a burst that quiesces on a rejection has a rejection in it. Only the indeterminate quiesce is left, and that is where the clear goes.
- **Round-1 CR1 (spec contradiction): fixed.**
  - I word-diffed the delta's MODIFIED "A counter's optimistic rollback is scoped..." against the base requirement (`spec.md:459`). The only change is one appended sentence that routes the non-owner case to the new requirement. All 10 scenarios are kept verbatim, so the MODIFIED block is a complete replacement.
  - The MODIFIED "A stale counter rejection error is cleared once a later burst reconciles" (`spec.md:712`) is now scoped to the owner, cross-references the non-owner requirement, and keeps all three scenarios. The "failed reconciliation" scenario is owner-scoped.
  - Design D2 now states and justifies the owner/non-owner asymmetry. An owner can still get real evidence from a later fetch. A non-owner never can, and the ticket delegates "whatever signal that path has".
- **Round-1 CR2 (e2e/jest proof set): fixed.**
  - I re-ran D1's derivation commands in the worktree.
  - The e2e grep returns exactly the 12 named specs plus `hel1756-popover-viewport-fit`. Its only match is `document.querySelector("form")` (line 402, a popover form), so excluding it is correct.
  - `hel1307-conditional-formatting` is gone from the list.
  - The jest grep plus the `ls` return exactly the 7 named files.
  - A broader grep (`counter|/submit|form-panel|panel-content--form`) found only false positives: `ApiRequestCounter` and `makeInteractionCounter`.
- **Round-1 CR3 (empty Standing Constraints): fixed.** `tasks.md` lists C1-C5, which restate lane constraints C12, C13, C14, C4 and C1.
- **Round-1 non-blocking notes: all addressed.**
  - The same-burst test is labelled a GUARD, and D2 requires the indeterminate step to settle after the rejection.
  - The hook-input list is marked non-exhaustive.
  - `workflow-state.md` records `EXECUTION_STOP_POINT: after task 3.2`, and constraint C5 says the same.
- **D2 test harness exists:** `FormPanelView.nonOwner.test.tsx` already mocks `submitFormPanel` with both `definiteRejection()` and `new Error("Network Error")`, and asserts on `[aria-invalid='true']` (lines 149-186). The red-first test is feasible as described.
- **D3 phasing:** measure, stop, escalate, amend the design, add the `form-panel-rendering` delta, then re-gate before any fit code.
  - This is sound. The ticket itself requires escalation of the option.
  - The existing `form-panel-rendering` requirement "A form panel is sized for a grid cell" (lines 146-158) mandates scroll-inside-card, so it will need a MODIFIED delta. The proposal already says so.
  - AC1 and AC2 ("before and after") are only partly coverable before the owner rules. That is acknowledged, not hidden.

### Verdict: CONFIRM

### Non-blocking notes

- `frontend/src/features/panels/ui/PanelContent.test.tsx:466` renders the real `FormPanelView` through `FormRenderer`, but it does not import from `ui/form/`, so D1's grep misses it. The same probably applies to the form case in `PanelCardHeader.refreshFullscreen.test.tsx:146`. Consider adding both to the before/after jest counts. Task 4.1's "full jest for `features/panels/ui/form`" does not reach them either, though the evaluator's full suite will.
- The MODIFIED rollback requirement still reads "it is cleared only by ... or ... a LATER burst's reconciliation", and the appended sentence then adds the non-owner exception. That is consistent, but a reader could trip on "only". Folding "or, for a non-owner, ..." into that same sentence would read more cleanly. This is optional.
- In the red-first test, also assert that the assertive region holds the "Couldn't confirm" text. That proves the clear came from the indeterminate quiesce and not from a success settle that slipped in.
