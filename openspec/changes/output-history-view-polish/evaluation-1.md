## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `3a74d68f22c0c74ea13a7a9458fcfff7ac64e67c`. Base was resolved live with `resolve-review-base.sh`: `a606a9833910e36ad544e6aff6e4b87049245559`.

### Phase 1: Spec Review — FAIL

All four ticket items are implemented and match design D1–D4:
- History button: radius-sm and weight-medium. `font-weight` comes after `font: inherit`. The hover stays raised.
- The "No row changes vs <time>" note is shown.
- The table uses `max-height: 360px`.
- `formatCapturePair` escalates minute -> second -> millisecond, then adds "(older capture)". `sameMinute` is removed. `HistoryScrubber` and `chartOverlay.ts` are unchanged.

The spec delta matches the implementation. There is no scope creep and no API or schema change.

Constraints:
- **C1: honored.** I re-measured it myself in the running app (see Phase 3).
- **C2: honored in fact, but the executor never measured it.** I measured it myself (see Phase 3).

Issues:
1. Task 4.2 is ticked `[x]`, but its required evidence is missing. It requires "the rendered hover contrast ratio per [C2] recorded for each theme". `screenshots/measurements.json` has only rest-state `fontWeight`/`radius`/`bg` and the bounding boxes. It has no hover pixel sample and no ratio. The executor's own probe script took a hover screenshot but never sampled a pixel. So the "1.122 / 1.179 measured" figures in the `OutputGalleryCard.css` comment are the design's stylesheet arithmetic, not a measurement the executor took. The numbers turn out to be correct (see Phase 3). Still, the task claim was false when it was ticked.

### Phase 2: Code Review — FAIL

I ran every gate myself in WORKTREE_PATH, all at `nice -n 19`:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test` with `--maxWorkers=3`: exit 0. Frontend 456/456 suites, 4804 tests. helio-mcp 39/39 suites, 376 tests.

`PanelCard.test.tsx` passed in my full run. The executor's flake attribution therefore had nothing to explain in my run; I take no position on it.

I also ran a revert/mutation check, which the executor had not done. I made a throwaway detached worktree at `3a74d68f2` with a copied `node_modules`, and removed it afterwards (`git worktree list` shows no straggler). Starting from a green baseline (32/32 in `formatCaptureTime` + `OutputHistoryModal*`), I applied each mutation and re-ran:

| Mutation | Result |
|---|---|
| `formatCapturePair` cut back to minute/second, no suffix | 4 failed (caught) |
| "(older capture)" suffix removed | 2 failed (caught) |
| Header forced to minute precision | 2 failed (caught) |
| "No row changes" branch removed | 1 failed (caught) |
| **`diff.changed.size === 0` guard removed** (note shows even when rows changed) | **32 passed (survives)** |
| Chart overlay label not routed through the helper | 32 passed (survives) |
| Rows note label not routed through the helper | 32 passed (survives) |
| Metric baseline label replaced | 32 passed (survives) |
| CSS: radius reverted, weight removed, weight moved before `font: inherit`, hover set to soft, `height: 360px` restored, `height` + `max-height` both present | each 1 failed (caught) |

Issues:
1. **The guard on the new "No row changes" branch is untested.** In `frontend/src/features/pipelines/ui/outputHistory/HistoryRows.tsx:89-92`, the note is gated on `diff.changed.size === 0` as well as no removed rows. Replacing that condition with `true` passes the whole suite. That mutation would make the view say "No row changes" when rows were added or changed but none removed. The spec forbids this, and its own "Duplicates are a multiset" scenario (comparison {a:1}, selected {a:1},{a:1}) is exactly that case. No existing test covers changed-but-nothing-removed. The only diff tests either remove a row (line 192) or are identical (line 265). This is the correctness boundary of the new code path, so a regression there must turn a test red.

No [mechanical] violations of CONTRIBUTING.md or DESIGN.md: tokens only, no magic values, no `any`, no dead code, no inline FQNs.

The D1 deviation from DESIGN.md §5 Ghost (hover raised, not soft) is documented in the design and the CSS comment, and it is backed by a measurement (Phase 3).

### Phase 3: UI Review — PASS

I first checked that the dev servers belong to this worktree:
- The listener PIDs on 6784 and 9691 have their cwd in this worktree's `frontend/` and `backend/`.
- Vite serves the HEL-1352 version of both stylesheets.
- `start-servers.sh` reused both servers, and `assert-phase.sh servers` returned PASS.

I drove the app from my own Node Playwright script with a lane-private persistent profile (no shared MCP browser, no `/tmp` cookie jar). I used my own throwaway user `hel1352-eval-…@example.test`, set to beta tier through an exact-id update. I created three static sources with 2, 60 and 400 rows. Each got a pipeline, a table Output with `historyPayloads`, and two identical runs; the two captures were about 60–70 ms apart (same second). Afterwards I deleted the 3 pipelines and 3 sources by exact id (all 204).

Measured values:
- **C1 (both themes, identical results):**
  - 2 rows: `.output-history__table` 157px, `.ui-data-grid` 104px (scrollHeight 104). The note is 8px below the table.
  - 60 rows: table 360px, grid 307px, scrollHeight 2134, so it scrolls inside the cap.
  - 400 rows, virtualised: table 360px, grid 307px, scrollHeight about 14,020. Scrolled to the bottom, the last rendered row is `r399`, and its bottom (739.9 / 739.4) is level with the grid bottom (739.9). There is no blank spacer gap and the table does not grow.
- **C2:** I hovered the button, waited for transitions, then sampled the button pixel and the hovered-card pixel 1px each from a real screenshot.
  - Light: button (255,255,255) vs card (239,236,230), **ratio 1.179**.
  - Dark: button (35,32,25) vs card (22,21,20), **ratio 1.122**.
  - Both are at or above the 1.10 threshold. Computed `fontWeight` is `500` and radius is `6px` in both themes.
- **Labels:** header "Oct 7, 10:11:17.996 AM" vs caption "vs Oct 7, 10:11:17.927 AM". The two read differently, each with milliseconds. The note reads "No row changes vs Oct 7, 10:11:17.927 AM".
- **Breakpoints (1440 / 1100 / 768 / 375):** dialog widths 960 / 960 / 730 / 337. No horizontal document overflow at any width. Short table height 157 / 157 / 157 / 192.5.
- **Console:** no page errors. The only failed requests were `GET /api/pipelines/:id/schedule` returning 404. That comes from the pipeline page when a pipeline has no schedule; it predates this change and is not touched by the diff.

### Overall: FAIL

### Change Requests
1. **Add an RTL test for "rows changed, none removed" in `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.test.tsx`** (next to the line-265 test).
   - Setup: two points with payloads, `fetchRows` returning `[{a:1},{a:1}]` for the selected point and `[{a:1}]` for the comparison point (the spec's multiset scenario), or `[{a:1},{a:2}]` vs `[{a:1}]`.
   - Assert: "New or changed" is present, `queryByText(/no longer present/)` is null, and `queryByText(/No row changes/)` is null.
   - Verify it goes red when `diff.changed.size === 0` in `HistoryRows.tsx:90` is replaced with `true`.
2. **Record the C2 rendered hover contrast in `openspec/changes/output-history-view-polish/screenshots/measurements.json`**, or un-tick task 4.2. Record the hovered-button pixel, the hovered-card pixel and the ratio for each theme, taken from a real screenshot after transitions settle. My values above can be reproduced the same way. Make the `OutputGalleryCard.css:62-65` comment cite a rendered measurement that is actually on record.

### Non-blocking Suggestions
- Three label paths in the spec's "every place the view renders the comparison's 'vs' label" list have no same-second test: the chart overlay, the rows comparison note and the metric baseline. All three survived mutation. A same-second variant of the line-265 test, asserting the note contains the millisecond digits, would cover the rows note cheaply. The chart overlay test at line 329 could assert its label with same-second points.
- `formatCaptureTime.ts:3` swapped the original comment's em-dash for `--`. This is harmless drive-by churn.
- After Escape closes the History dialog, focus lands on `BODY` instead of returning to the History button. This happened on all three Outputs. The modal code is not in this diff, so it is likely a pre-existing HEL-1277 behaviour. Worth a follow-up check.
- The executor's lane user and mine (`803176ea-dd3b-4ebb-8460-80c638f156f4`) remain in the shared dev DB without data. There is no account-delete API.
