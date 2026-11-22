## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 1f8e762b5b0055a2c1c76eddd47771eeca8823db (planning artifacts untracked in the worktree).

### What I verified (with evidence)

- All files the design cites exist at HEAD: `usePipelineDraftFrames.ts`, `usePipelineDetailPage.ts`,
  `ui/stepConfigs/StringOpsConfig.tsx`, `shared/ui/useScrollEdges.ts` (+ test), `e2e/hel1683-regex-main-thread.spec.ts`,
  the five e2e draft specs in D7, the `*.sessionEpoch.test.tsx` suites, `evaluator/pipelineStepParity.test.ts`.
  `useScrollEdges` consumers: `DataGrid.tsx:523`, `SortableTable.tsx`, `EditFormScrollArea.tsx` (and `useVirtualRows`
  shares DataGrid's scroll ref).
- `usePipelineDraftFrames.ts:171-183`: `walkBase = hasDraft || needBase`; `baseWalk` is a `useMemo` on
  `[baseDefs, savedRootFrames, sources]`; `sources` comes from `secondarySourceIds(draftSteps)` (the DRAFT's secondaries,
  line 151-159). `selectSourceFrames` is a `createSelector` (`sourceSamplesSlice.ts:172`), so it is not trivially
  churning.
- `usePipelineDraftPresentation.ts:40`: `needBase: page.allOutputs.length > 0`. The comment at
  `usePipelineDraftFrames.ts:74-80` says the saved side is walked only when an Output exists, "so ... a first edit does
  not pay for it" - i.e. a pipeline with no Output pays the saved walk on its first edit.
- HEL-1683 probe seed (`hel1683-regex-main-thread.spec.ts:39-61`): source + pipeline + one `extractRegex` step + a run.
  No Output is created, so `needBase` is false. The control window (`:252-258`) is a single `pattern.fill(...)` - the
  first edit of the page, the `hasDraft` false -> true transition.
- `main.tsx:113` wraps the app in `React.StrictMode`, so in the dev build every `useMemo` factory runs twice and mount
  effects run twice.
- HEL-1808 `attribution.md:41-42`: a 150 ms-per-row busy loop in the client extractRegex made the control red at
  1209 ms over 2 rows, "the walk runs it several times". 1209 / (150 x 2) is about 4 step evaluations per fill, which is
  what saved x2 + draft x2 under StrictMode would give (my inference, not measured).
- HEL-1697 `skeptic-final-1.md:42-66`: the 13-18 ms `useScrollEdges.ts:31` self time was measured INSIDE the
  synchronous `dispatchDiscreteEvent` input task, on a 400 x 3,000 frame.
- `useScrollEdges.ts`: `measure` runs from a mount-only `useLayoutEffect` and from scroll / window resize /
  ResizeObserver listeners. Scroll and ResizeObserver callbacks are not dispatched inside a synchronous input event
  handler; the mount layout effect is. `StepPreviewTable.tsx:225-283` renders the draft `DataGrid` and the saved
  `DataGrid` in different branches, so a no-draft -> draft switch can mount a new `DataGrid` (and its layout-effect
  measure, a forced layout of the new table) inside the keystroke.
- Existing tests that assert scroll-edge state synchronously after `fireEvent.scroll`: `useScrollEdges.test.tsx:61,69,138`,
  `DataGrid.test.tsx:362-376` and `:1687`, `PanelDetailModal.editScrollFade.test.tsx:130`.

### Verdict: REFUTE

The profile-first framing (D1, escalation clause) is right, and D2's "reduce, don't move" rule is good. But the plan
targets mechanisms that the evidence already suggests are not what the AC's own measurement captures. It also measures
walk counts in a way that would report a dev-only artifact as the defect.

### Change Requests

1. **State what the AC2 control window actually measures, and profile both cases separately (design.md D1, D6;
   tasks 1.1-1.4).** The HEL-1683 control window is one `fill` on a pipeline with no Output. It is the FIRST edit
   (`hasDraft` false -> true), so it measures the first-time saved walk (`walkBase` turning on), the draft transport
   being enabled, the "Draft · unsaved changes" chrome appearing and the preview table switching to its draft branch. It
   does not measure a steady-state keystroke. D1 must profile (i) the first edit and (ii) a later keystroke on an
   existing draft as separate measurements, with render counts, walk counts and LoAF for each. `profile-findings.md`
   must say which of them the AC2 control number reflects.

2. **Decide, in the design, whether the first-edit saved walk may be computed earlier (design.md D2/D3).** If the
   profile confirms (1), the only way to take the saved walk out of the control window is to compute it before the first
   edit. The code already does this for pipelines with an Output (`needBase`). As written, D2 ("deferring ... does not
   count") and D3 ("keyed on saved inputs") leave it ambiguous whether that counts as "moving work" (forbidden) or as
   removing a walk from the keystroke (allowed). Resolve it explicitly. If the planner decides it is outside its
   authority (it changes when a no-Output pipeline pays for a walk on load), raise an ESCALATION before execution. Do not
   leave the executor to decide it.

3. **Count walks so that StrictMode double-invocation is not reported as a "repeated walk" (D1(b), D5(i), task 1.1,
   4.1).** The dev build runs under `React.StrictMode` (`main.tsx:113`), which runs every `useMemo` factory twice. A
   counter inside `evaluatePipeline`/the walker in the dev build will show 2x saved and 2x draft per fill. The HEL-1808
   busy-loop mutation (about 4 evaluations per fill) is consistent with exactly that. D1(b) must count walks in the
   production build, or count distinct memo commits and not factory calls, and must state the StrictMode factor. The
   regression test (4.1) must say whether it renders under StrictMode, and what "re-walk" means there. "No repeated
   walk" in AC1 must be shown on the production count. If the only repetition turns out to be StrictMode, that is the
   D1 escalation case ("no saved re-walk exists"), not something to fix.

4. **Attribute the `useScrollEdges` cost to its call path before committing to the D4 fix (D1(d), D4, task 1.3, 2.3).**
   The measured 13-18 ms was self time inside the synchronous input task. Of `measure`'s four triggers, only the mount
   `useLayoutEffect` runs inside that task. That points to a `DataGrid` being (re)mounted on the keystroke, which forces
   a layout of the new table, and not to a burst of scroll/observer updates. D4's bail-out and rAF coalescing would not
   touch that path, and the per-scroll synthetic measurement in task 1.3 could "improve" while the keystroke cost stays
   the same. Required:
   (a) D1(d) records, for the keystroke, which trigger ran `measure` (layout effect vs scroll vs ResizeObserver vs
   resize) and whether its self time is forced layout (`scrollWidth`/`scrollHeight` read) or the state update and
   re-render.
   (b) D4 becomes conditional on that attribution. If the cost is a remount (for example `StepPreviewTable`'s
   saved/draft `DataGrid` branches at `StepPreviewTable.tsx:245` vs `:278`), the fix is to avoid the remount.
   (c) AC1's "lower on a 1,000-row frame" is measured on the same keystroke-driven path as the original finding, not
   only on a synthetic scroll.

5. **Do not coalesce `scroll`-driven measurement to rAF without accounting for the synchronous consumers (D4).** D4
   says "observer/scroll bursts are coalesced ... public semantics unchanged" and D7 says existing tests pass.
   `useScrollEdges.test.tsx:61,69,138`, `DataGrid.test.tsx:362-376,1687` and
   `PanelDetailModal.editScrollFade.test.tsx:130` all assert edge state synchronously after `fireEvent.scroll`, so
   coalescing scroll events would turn them red. Editing those tests to await a frame is a fixture-change-as-symptom.
   Either limit coalescing to ResizeObserver/resize callbacks and keep scroll measurement synchronous (with the
   bail-out), or list each test change in the design with its justification and a reason the shadow timing change is
   acceptable.

6. **Fix the AC2 comparison rule before any "before" number is taken (D6).** HEL-1808 recorded 4x control readings of
   62-72 ms, and 0-58 ms at 6x, with run-to-run spread larger than a plausible improvement. "At least 3 runs, range and
   median" does not say what counts as "smaller". State the criterion now (for example: after-median below before-median
   at 4x, same host, same Playwright worker count, interleaved or back-to-back runs, n >= 5). Say what is reported if the
   ranges overlap. Otherwise the AC verdict can be chosen after the data is seen.

7. **Address D3's behaviour risk explicitly.** The saved walk currently reads `sources` derived from the DRAFT's
   secondaries (`usePipelineDraftFrames.ts:151-159, 181`). "Keyed on saved inputs only" could be read as switching the
   saved walk to the saved steps' secondaries. That changes the saved-side frames whenever the draft adds or removes a
   join/union/lookup secondary, and through `tracker.derive(draftWalk, baseWalk, ...)` it changes counts and flashes.
   That contradicts "no behaviour change". Say which reading is intended. If the source set changes, add a test that
   saved-vs-draft counts and flashes are identical before and after for add-secondary and remove-secondary drafts.

### Non-blocking notes

- D5(ii)'s "expected components" set is defined only after the profile. Task 1.5 / `profile-findings.md` should name
  that set before 4.2 is written, so the test is not shaped to fit the fix.
- Task numbering jumps from 2 to 4 (no section 3). This is cosmetic.
- D1(c) prod via `vite preview` "inherits the dev proxy". Confirm that `preview.proxy` is actually configured to the
  lane backend port before relying on it. Lane constraints require a free port picked by the executor and a stop by
  exact PID.
