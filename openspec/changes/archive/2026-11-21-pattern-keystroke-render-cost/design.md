## Context

See proposal.md (Why). Relevant code as of main 1f8e762b5:

- `frontend/src/features/pipelines/hooks/usePipelineDraftFrames.ts` walks the saved steps (`baseWalk`, a plain
  `evaluatePipeline` over `baseDefs`/`savedRootFrames`/`sources`) and the draft steps (`draftWalk`, the incremental
  walker) in `useMemo`s. `baseWalk` is keyed on `sources`, which derives from `secondarySourceIds(draftSteps)` and a
  `selectSourceFrames` selector, and on `baseDefs`/`savedRootFrames`. Any identity churn in those inputs re-runs the saved
  walk on a draft edit. Which input actually churns is NOT known yet: the profile decides (D1).
- The page state lives in `usePipelineDetailPage.ts` and its sub-hooks; the step config UI for `extractRegex` is
  `ui/stepConfigs/StringOpsConfig.tsx`.
- `frontend/src/shared/ui/useScrollEdges.ts` calls `setEdges({...})` with a fresh object on every scroll, window resize
  and ResizeObserver callback, and reads `scrollWidth`/`scrollHeight` (forced layout) each time.
- HEL-1798's session-epoch guards live in the pipeline hooks (`*.sessionEpoch.test.tsx`); they must stay intact.
- `e2e/hel1683-regex-main-thread.spec.ts` has the HEL-1808 `HEL1808_CPU_THROTTLE` switch and Long Animation Frame logging.

## Goals / Non-Goals

**Goals:** measured, attributed reduction of the keystroke's main-thread work; no repeated saved walk on a draft edit;
cheaper scroll-edge updates; regression tests that are deterministic (counts, not time).

**Non-Goals:** CI prod-build probes (HEL-1816); probe reshaping; any change to evaluator semantics, preview request
contents or debounce timing; refactors the profile does not motivate.

## Decisions

**D1. Profile before changing code (systematic-debugging law).** "Before" evidence is committed before any source
change. It covers two cases SEPARATELY, because they do different work: (A) the FIRST edit of a pipeline with no Output
(`hasDraft` false -> true; this turns on `walkBase`, enables the transport, shows the draft chrome and may switch
`StepPreviewTable` from its saved `DataGrid` branch to its draft branch) - this is what the HEL-1683 control window
measures (one `fill`, seed has no Output, `needBase` false); and (B) a later keystroke on an existing draft. For each
case: (a) per-component render counts and why each rendered (React Profiler `onRender` plus changed props/state/context),
dev build; (b) saved and draft walk counts, counted in the PRODUCTION build or per committed render, never as raw `useMemo`
factory calls (the dev build runs under `React.StrictMode`, `main.tsx:113`, which runs every memo factory twice; the
factor is stated); (c) LoAF script duration of the input handler at 1x and 4x throttle, dev AND production (`vite build`
+ `vite preview --port <free port>`; the executor confirms `/api` reaches the lane backend before relying on it);
(d) for `useScrollEdges` on a 1,000-row frame, which trigger ran `measure` inside the keystroke task (mount layout effect
vs scroll vs ResizeObserver vs resize), whether its self time is forced layout (`scrollWidth`/`scrollHeight`) or the
state update and re-render, and whether a `DataGrid` remounted. `profile-findings.md` states which case the AC2 control
number reflects and names, BEFORE task 4.2 is written, the set of components a keystroke is expected to re-render.
Measurement-only instrumentation stays out of shipped code. If the profile contradicts the ticket (no saved re-walk
beyond StrictMode, or the cost not in the page's render), the executor reports it and raises an ESCALATION; it does not
invent a fix.

**D2. Reduce work, do not just move it.** A fix counts only if it removes work (fewer renders, fewer walks, fewer layout
reads, no needless remount). `startTransition`/`useDeferredValue` or deferring the draft commit alone are excluded.
Planner ruling on the first-edit saved walk (case A): computing the saved walk at page load for a pipeline with no Output
moves work from the first edit to load and changes load cost for every such pipeline; it is NOT done in this ticket. The
first-edit saved walk is not a "repeated walk", so AC1's "no repeated walk" is judged on case B and on case A having
exactly one saved walk across the whole first-edit keystroke (all its commits), counted per commit to exclude
StrictMode. If, after the allowed fixes, the AC2 control number cannot improve because
the first-edit walk dominates it, the executor raises an ESCALATION (options: precompute at load / accept the measured
result) rather than choosing.

**D3. Saved walk: same inputs, stable identities.** The saved walk keeps reading exactly the same frames as today -
including `sources` derived from the DRAFT's secondaries (`usePipelineDraftFrames.ts:151-159, 181`); switching it to the
saved steps' secondaries would change counts and flashes and is out of scope. Only identity churn the profile names (a
fresh array/object for unchanged content) is stabilised at its source. The saved walk must still re-run when a saved step,
a saved root sample or a source frame it reads changes; a test covers that.

**D4. Scroll edges: conditional on D1(d).** If the keystroke cost is a `DataGrid` remount (the saved/draft branches of
`StepPreviewTable.tsx`, ~:245 vs ~:278), the fix is to keep one mounted grid across the switch. Independently,
`measure` bails out (no state update, no re-render) when every edge is unchanged. Scroll-driven measurement stays
synchronous: `useScrollEdges.test.tsx:61,69,138`, `DataGrid.test.tsx:362-376,1687` and
`PanelDetailModal.editScrollFade.test.tsx:130` are not edited and must pass. Coalescing to one measurement per animation
frame is allowed only for ResizeObserver/resize callbacks, and only if D1(d) shows they fire in bursts; the first
measurement stays synchronous in the layout effect. AC1's "lower on a 1,000-row frame" is measured on the same
keystroke-driven path as the original finding, not only on a synthetic scroll.

**D5. Regression tests: counts, red first.** Jest tests assert (i) a draft-only Pattern change does not re-run the saved
walk, and a saved-input change still does; (ii) a Pattern keystroke re-renders only the component set named in
`profile-findings.md`; (iii) `useScrollEdges` does not re-render when a measure finds unchanged edges; (iv) if D4 removes
a remount, the grid DOM node survives the saved -> draft switch. Each test states whether it renders under StrictMode and
counts per committed render accordingly. Each is shown red on the unfixed tree, or via a named mutation that re-introduces
the defect, before acceptance. No wall-clock assertion.

**D6. AC2 comparison rule (fixed now, before any number is taken).** The HEL-1683 spec runs with
`HEL1808_CPU_THROTTLE=4`, the same host, the same Playwright worker count (1 for these runs), n = 5 before and n = 5
after, back-to-back sessions with no other lane's Playwright running. The reading is the control window's input-handler
LoAF script duration (the `DIV#root.oninput` entry). AC2 is met when the after-median is below the before-median; every
run, both medians and both ranges are reported. If the ranges overlap, the report says so plainly and the claim is limited
to the medians. If the after-median is not below the before-median, that is not met and the executor escalates (see D2).
1x full-spec passes are the gate; throttled runs are diagnostic.

**D7. Behaviour preservation evidence.** Parity corpus (`evaluator/pipelineStepParity.test.ts`, regex tests),
session-epoch tests, the draft hook tests, `useScrollEdges.test.tsx`, `DataGrid.test.tsx`, and e2e
`hel1683-regex-main-thread`, `hel1631-draft-mode`, `hel1685-draft-polish`, `hel1733-draft-outputs-shapes-*`,
`hel1734-draft-roots` all pass.

## Risks / Trade-offs

- [Memoisation hides a needed update (stale preview)] -> D3/D7: walk must still re-run on real input change; e2e draft
  specs and a test for "saved step change still re-walks".
- [Keeping one grid mounted across saved/draft changes what it shows] -> D5(iv) plus e2e draft specs; cells and
  scroll position compared before/after.
- [Dev-only cost (React dev build overhead) dominates] -> D1(c) measures prod too; findings stated either way.
- [Profiling numbers are noisy] -> counts are the gate; durations are reported as ranges over >=3 runs.

## Planner Notes

- Self-approved: no spec delta (`skip_specs: true`); behaviour is unchanged and no requirement text applies.
- Self-approved: exact fix list deferred to the D1 profile; D2-D4 bound what fixes are acceptable.
- Self-approved (D2): no load-time precompute of the saved walk; escalate if AC2 cannot be met without it.
- Design gate round 1 (REFUTE) addressed: first-edit vs later keystroke, StrictMode factor, scroll-edge attribution,
  synchronous scroll, AC2 rule fixed up front, saved-walk sources unchanged.
