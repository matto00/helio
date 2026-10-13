# HEL-1501: After HEL-1483: steps error state with Retry; shared river skeleton; dedupe the settled-render test helper; split usePipelineDetailPage/pipelinesSlice; switch-test tightening

## Description

These follow-ups came from HEL-1483 (matto00/helio#951, 5a53d24b9), which keyed the pipeline page by `:id` and
guarded the shared pipeline state by id.

1. **Steps error state with Retry** when the page's own steps fetch fails. Today a failed fetch falls back to the
   empty editor.
2. **One shared river-skeleton component** instead of duplicating `PipelineDetailSkeleton`'s river block.
3. **Collapse the three copies** of the settled-render test helper (`renderDetailPageSettled` / `renderPageSettled`).
4. **Split** `usePipelineDetailPage.ts` **and** `pipelinesSlice.ts`, both over the ~400-line guideline,
   behaviour-preserving, to the HEL-1465 proof standard. This overlaps HEL-1484, so consider doing them together.
5. **Switch-test tightening:**
   * The two "B converges when A's continuation refetches A late" tests are misnamed now.
   * Add `expect(getPipelineById).toHaveBeenLastCalledWith("B")` to the direct-fetch test.
   * Clear the `act(...)` warnings in `PipelineDetailPage.switch.test.tsx`.
6. **Product call:** should Run and Dry run be disabled while the steps skeleton shows? Today they stay enabled.

## Acceptance Criteria

- AC1: When this mount's steps fetch fails, the Steps tab shows a visible, human-readable error (DESIGN.md §7,
  existing `PageStatus status="failed"` pattern) with a Retry control, never the empty editor / "No steps yet".
  Retry re-issues the steps fetch, shows the steps skeleton while it is in flight, and on success renders the
  pipeline's persisted steps exactly as a first open would.
- AC2: The steps skeleton in `PipelineDetailPage.tsx` and the river block in `PipelineDetailSkeleton.tsx` render one
  shared component; rendered markup is unchanged apart from the wrappers named in design.md.
- AC3: One settled-render helper serves the three pipeline-detail test files; no assertion weakened.
- AC4: `pipelinesSlice.ts` at or under ~400 lines; `usePipelineDetailPage.ts` reduced by every verbatim
  order-preserving cluster move (design D3), remainder filed as a Follow-up if still over ~400; both split behaviour-preserving
  with HEL-1465-standard proof (byte-move script with a red run, hook-sequence comparison, import-only test diffs,
  characterization green on base first). Public import surface of `pipelinesSlice` is unchanged.
- AC5: Switch tests renamed to match behaviour; the direct-fetch test asserts `getPipelineById` was last called with
  "B"; `PipelineDetailPage.switch.test.tsx` emits zero `act(...)` warnings (before/after counts recorded).
- AC6: Item 6 is decided as an assumed product call (recorded in the PR's OWNER REVIEW section).
- Parked PRs #998 / #994 files are not touched (laneLayout.ts, SecondaryInputPicker.tsx, patchSets/*, assistant/*).
