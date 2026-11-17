# HEL-1705 evidence

## 1. Red on unmodified code (C6)

Recorded before any fix, on the unmodified tree.

### 1.1 H: wire key order of `GET /api/outputs/:id/rows`

Test: `OutputRoutesSpec` "write each row's keys and `columns` in the Output's schema order, with unnamed keys last (HEL-1705)".
Schema `zeta, 10, alpha`; stored row also holds `extra`. Positions of the four keys in the raw body text:

```
$ sbt "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1705"
[info] - should write each row's keys and `columns` in the Output's schema order, with unnamed keys last (HEL-1705) *** FAILED ***
[info]   Vector(34, 2, 9, 21) did not equal Vector(2, 9, 21, 34) (OutputRoutesSpec.scala:734)
[info] *** 1 TEST FAILED ***
```

The wire order is `10, alpha, extra, zeta` (spray-json's TreeMap, alphabetical), not the schema order.
Premise correction (design.md): the draft-preview column order is already deterministic (`orderLiveColumns`); the divergence is the saved path.

### 1.2 D: unfocused server-resolved Output stays stale

Test: `usePipelineDraftFrames.unfocusedOutput.test.tsx`. Steps `s1 convertformat -> s2 limit`, focus `s1`, the displayed
Output's node is `s2`; the fake server answers like the fixed endpoint (a rows line per requested id).

```
$ npx jest src/features/pipelines/hooks/usePipelineDraftFrames.unfocusedOutput
  ● an unfocused server-resolved Output (HEL-1705 D) › gets its rows from the one request, while another step is focused
    expect(received).not.toBeNull()
    Received: null
    > 108 |     expect(s2?.rows).not.toBeNull();
Tests: 1 failed, 1 total
```

`s2` has no rows (`liveOutputSource` then shows "Select this step to update it").

## 2. Green after the fixes

- 1.1: the same test (`OutputRoutesSpec` "write each row's keys and `columns` in the Output's schema order ...") passes; the public panel rows route
  (`PublicDashboardRoutesSpec`) and the history-payload route (`OutputHistoryPayloadRoutesSpec`) carry the same raw-body order tests.
  Each reads the RAW response text, so neither spray-json's TreeMap nor a browser's integer-like-key reordering can hide a regression.
- 1.2: `usePipelineDraftFrames.unfocusedOutput.test.tsx` "gets its rows from the one request, while another step is focused" passes: `s2` has rows,
  `frameStale` false, and one request was posted.

## 3. C5: request count (task 4.5)

`usePipelineDraftFrames.unfocusedOutput.test.tsx`, "request count": ten edits to a server step 100 ms apart under the real scheduler
(fake clock; debounce 350 ms, max wait 600 ms, floor 600 ms), then the clock runs out. Requests posted:

| case                                                   | requests |
| ------------------------------------------------------ | -------- |
| no Output displayed                                    | 2        |
| a non-focus server-resolved Output displayed (`s2`)    | 2        |
| the Output displayed from edit 5 on (a mid-burst swap) | 2        |

Equal counts: the displayed Output's node rides on the one paced request as `rowsStepIds`; the scheduler is unchanged.
Mutation: a request key that churns when `rowsStepIds` is non-empty (`Math.random()` in `draftPreviewRequest.ts`'s key) turns the test red
(`displayed=11 switched=11`, expected 2), then was reverted.
The phone's explicit-pick case is covered at the seam that differs, `useDisplayedOutputNodeIds.test.ts` (an explicit pick of a non-focus Output,
resolved against the Preview tab's step) and `resolvePreviewStepId.test.ts`; both layouts feed the same hook.

## 4. C5: heap (task 4.3), `DraftPreviewHeapSpec`

New shape `extra-ids`: one 1,000-row step with eight `compute` leaves, all eight named in `rowsStepIds`, each leaf frame 1,000 distinct
6,000-character texts. Every requested frame is held for its `rows` line and charged to the one live-cell budget, so the later ones are refused
with the text/memory-limit message while the first are returned. Report (`HELIO_HEAP_EVIDENCE_PATH` output, 12 shapes):

```
shape chain       max 71.4   shape comb        max 54.0   shape lane-held   max 56.0   shape select-held max 74.6
shape fresh-chain max 61.2   shape doubling-5  max 30.8   shape doubling-6  max 30.8   shape fan-out-text max 2.5
shape split-fan-out max 2.5  shape headings-fan-out max 2.5  shape pivot-fan-out max 2.5
shape extra-ids   body 3049965 bytes, 7 step lines, 2 error lines, deltas MB: 42.2, 42.2, 42.2; max 42.2
max over shapes MB: 74.6 (bound 96.0)
in-flight default = min(8, floor(192 / 74.6)) = 2
```

Peak 42.2 MB for the new shape; the maximum over shapes is unchanged at about 74.6 MB (it was 74.5 MB before; run-to-run noise on
`select-held`), at or under the 96 MB bound, and `DefaultMaxInFlight` is still 2.

## 5. Running app (task 4.10)

`e2e/hel1705-live-output-refresh.spec.ts` against the worktree's dev servers (ports 7137/10044), 4 passed:
- D: with step 3 (first `convertformat`) selected and the "Converted" Output (on the second) displayed, one edit sends exactly one
  draft-preview POST with `rowsStepId` = step 3 and `rowsStepIds` = [step 4]; the Output turns "live", no "Select this step to update it"; a second edit is exactly one more request.
- E (light and dark): `LATEST DURATION_S` tile shows 351 (last point), the live ECharts series list contains `vs previous`, the metric's `vs previous` trend shows.
- H: saved dashboard table headers equal the Output schema, the rows response `columns`, and the live column headers.
Screenshots (desktop 1280, phone 375, light and dark): `.concertino/scratch/HEL-1705/*.png`.
Finding: the engine derives Output schemas alphabetically, so a hand-ordered schema (the zeta, 10, alpha case) is proven by the route specs, not the e2e.

## 6. Gates

jest 771 suites / 9472 tests pass; lint, format:check, typecheck, `npm --prefix frontend run build`, helio-mcp types, schema-drift pass; `sbt testFull`:
9547 succeeded, 5 canceled (pre-existing), 3 failed on first run (key-set guards in `OutputFilteredMetricRoutesSpec` that did not expect `columns`), fixed and re-run green.

## 7. CI cycle 2 (PR #1134, run 44020064430)

### hel1705 spec "D" failure: a spec race, product correct (probe-confirmed)
Reproduced locally only under 6x CPU throttling (CDP `Emulation.setCPUThrottlingRate`): 13 of 16 runs failed with `rowsStepIds` undefined.
Probe (the selected spine row and the Displayed Output select, read after the pick): `after-pick: select=Converted cur=1Filter rows` then
`after-fill: select=Run duration cur=3Convert format`. The Step 3 click had returned before the selection landed, so the pick was made for step 1
and, by design ("an explicit pick holds only for the step it was made on"), dropped when step 3 became selected; the request then correctly had
no extra id. Fix: the spec waits for Step 3's `aria-current` before picking. Verified under the same 6x throttle: 12 of 12 pass (was 3 of 16).
No product change; the one-extra-pick-per-step rule is unchanged.

### hel1681 :129 "keyboard: Enter ... refreshes once": not caused by this diff
No path from the diff to the refresh button's row requests: `refresh()` in `usePanelData` and the `fetchPanelPage` dispatch are untouched; the diff adds
`columns`/`schemaNames` only to the fulfilled payload and the window reducer. Repeated runs of that one test (24 and 96 repeats at workers 2, nice 19):
main (origin/main 1d2fa5ab1, throwaway worktree frontend, same backend) 0 failures in 144 runs; this branch 1 failure in 144 runs (a 30 s timeout, not
the CI "Received 0" mode). Both rates are consistent with a rare pre-existing flake on a path the diff does not touch; no fix made.
