## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD f63ab8365d2b0e6cac36154a83437b6d26b3a209 (= SPLIT_BASE). The change dir is untracked and there are
no code changes. Every line number below was read from this tree.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-editor-steps-error-split/HEL-1501`.
- **Linear HEL-1501 has no formal ACs.** The ticket.md ACs are derived by the planner. AC4's revised wording ("reduced
  by every verbatim order-preserving cluster move (design D3), remainder filed as a Follow-up") narrows the ticket's
  item 4 for the hook (see note 1).

**CR1 (D3 line budget): resolved.**
- D3 now names SPLIT_BASE ranges with per-cluster estimates, drops the result-builder candidate (the return object stays
  verbatim, per the HEL-1481 precedent) and fixes the fallback in advance.
- I re-derived each cluster from the file:
  - **K1 L49-91.** 18 bindings come back out (sources, sourcesStatus, 8 run* fields, updateStatus/Error, reduxSteps,
    singletonIsOwn, 4 currentPipeline*). Net is about -20 to -23. It contains 2 `useAppSelector` and 1 `useState` and
    no other hooks.
  - **K2 L94-121.** Net about -15. `analyzeStatusRef` is returned, so D8 can pass it to `usePipelinePageLoad` (called at
    L276, after K2).
  - **K3 L161-220.** About 19 bindings returned. Net about -38.
  - **K4 L373-400.** Contiguous between the hook calls at L357 and L402. It contains `useEffect` and `useMemo`. Inputs:
    isDirty, roots, sources, currentPipeline, currentUser. Net about -10 to -15.
- The total is about 85, so the host lands around 505-510 lines with imports. That matches D3's "~490-510" honestly.
- **Fallback: sound.**
  - My round-1 count already showed that ≤400 needs every candidate, plus either a >250-line prelude hook or a reshaped
    return object.
  - Reshaping the return object changes `PipelineDetailPage.tsx`'s destructuring and needs its own proof regime.
  - CONTRIBUTING L24 treats ~400 as a soft trigger to propose a split, not a hard ceiling.
  - Deciding the fallback now, rather than improvising mid-execution, is the right call.

**CR2 (retry skips analyze): resolved.** D8 picks option (a) and states the seedToken interaction. I checked it
against the code:
- `usePipelineDebouncedAnalyze.ts` L64-67 consumes the token and sets `lastAnalyzedFingerprintRef = stepsFingerprint`.
- So the retry's own `analyzePipeline` going loading→succeeded re-enters the effect, but it bails at L120 (same
  fingerprint, not pending).
- Result: exactly one analyze on retry, with no duplicate. Analyze that succeeded at mount is not re-dispatched, so
  F-105 still holds.
- Tests are specified for both branches.

**CR3 (D7 incomplete): resolved.**
- D7 now covers the `it.each` at L455-485 and the comments at L386-387, L452-453 and L477.
- The scoped assertion snapshots `mock.calls.length` immediately before `navigateTo`. All three tests call `navigateTo`
  in the test body (L409, L441, L471), so the snapshot point exists.
- Red runs:
  - Removing `mountedRef.current &&` at `usePipelineRootAndToggleActions.ts` L64 makes A's continuation call
    `getPipelineById("A")` after the switch.
  - Removing the gate at L86 does the same through `Promise.all([dispatch(fetchPipelineById(id)), ...])`.
  - In both cases the call falls inside the scoped slice.

**CR4 (vacuous type-export proof): resolved.**
- D5 adds `import type { FetchRunHistoryArg, PipelinesState }` used in type positions in
  `state/pipelinesSlice.exports.test.ts`.
- `frontend/tsconfig.json` `include: ["src", ...]` covers test files, so `npm run typecheck` (`tsc --noEmit`) does
  check the pin.
- The red run is specified (delete the type re-export, and typecheck goes red).

**CR5 (header vs footer): resolved.**
- The spec says "the footer SHALL NOT report a step count of 0".
- D8 points at `PipelineDetailFooter.tsx` L218-220, which I confirmed renders `{stepCount} step(s)` only when
  `stepCount !== null`. The page passes it at L396.
- D8 sets `stepCount` to `null` when `stepsLoading || stepsFailed`.

**Fresh review.**
- **D2.**
  - Thunks reach the store only through `import type` (L4). The slice imports and re-exports the thunks, and the thunks
    never import the slice, so there is no runtime cycle.
  - Budget: about 707 - 234 (thunks) - ~39 (helpers) - 108 (state) + ~25 (imports and re-exports), which gives about
    350. That reaches ≤400.
- **D4.** The page L286-292 and `PipelineDetailSkeleton.tsx` L28-40 differ only by `role`/`aria-label` and a JSX
  comment. The prop-driven role is correct.
- **D8 seeding after retry.**
  - The condition at L260 is `!stepsInitialized && stepsFetchedThisMount && persistedSteps.length > 0`.
  - Failure never sets `stepsInitialized`, so it seeds on "fulfilled".
  - An empty pipeline falls through to the empty editor, which is correct, because a first open does the same.
- **Spec vs existing spec.** `openspec/specs/pipeline-editor-page/spec.md` L461 forbids a late previous-pipeline request
  from *replacing the new pipeline's displayed state*. Nothing in D8 does that (see note 2).
- **A1/A2.** These are reasonable assumed calls, routed to OWNER REVIEW, and the PR parks unmerged.

### Verdict: CONFIRM

### Non-blocking notes

1. **Surface the AC4 narrowing to the owner.** The fallback means ticket item 4 is only partly delivered for
   `usePipelineDetailPage.ts`. Record it in the PR's OWNER REVIEW section as assumed call A3, next to A1/A2: the
   measured line count plus the Follow-up id. Listing it only in the PR body is weaker. `workflow-state.md`
   `ASSUMED_PRODUCT_CALLS` lists only A1/A2.
2. **The retry's analyze dispatch is not mount-gated.**
   - The race: Retry is pressed (with analyze failed), then the user switches to B before the steps resolve. A's
     continuation then still dispatches `analyzePipeline("A")` after A has unmounted.
   - This is harmless to state, because `analyzeResult`/`analyzeStatus` are keyed per id. It is still a stray
     previous-pipeline request of exactly the kind HEL-1483's `mountedRef` gates exist to suppress.
   - Suggest gating the analyze dispatch (and `onStepsSettled`) on a mounted ref in `usePipelinePageLoad`.
3. **D3 leaves movable clusters unused, with no stated reason.**
   - L123-160 (steps/draft refs) sits between K2 and K3, and all of L94-220 is one contiguous run. Net is about -25.
   - The fingerprint block L304-310 nets about -15.
   - The clear-run effect L346-355 nets about -9.
   - None of these reaches 400, so the fallback stands. The executor should either take them or name them in the
     Follow-up as verbatim-movable, so the Follow-up's scope is accurate.
4. **`state/pipelinesThunks.ts` budget.** It will be about 290-300 lines (234 of thunks, ~39 of helpers, plus imports).
   That is over CONTRIBUTING's ~250 soft budget. D3 states a ≤~250 budget for new hook files, but D2 states none for
   this file. Either split the schedule thunks (L371-415) into their own file, or acknowledge the size in the PR.
5. **Host growth in commit 7.** D8 adds `onStepsRetry`, `stepsFailed` and `retryStepsLoad` to the host. Report the
   host line count after commit 7 as well as after commit 3.
6. **Round-1 notes not carried into the design.** They remain final-gate judgments:
   - the visual weight of the bare section `PageStatus` in the tabpanel (light and dark)
   - header root add/remove staying live in the failed state
   - the Outputs tab receiving `steps=[]` while failed
