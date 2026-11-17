## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `bcf8691dbd9abdcd01a2a181251566975a769047`. Base `0c699d2633e5dedbc14cb3bddaca6147dd6b6025`, resolved live with
`resolve-review-base.sh` (exit 0). The diff covers 105 files (+3275/-202).

### What I verified (with evidence)

**Gates (re-run fresh by me in WORKTREE_PATH, not taken from the evaluator)**
- `nice -n 19 sbt -J-Xmx3g testFull`: `Tests: succeeded 9550, failed 0, canceled 5`, `All tests passed.`, exit 0. No `*** FAILED`
  lines. This closes the gap the executor left after fixing `OutputFilteredMetricRoutesSpec`. The HEL-1705 specs ran in this run:
  the three wire-order route tests, `RowColumnOrderSpec`, `DeltaAndPctFixtureSpec`, the `rowsStepIds` stream tests and the heap shape
  `extra-ids` (max 42.3 MB; the later ids hit the text limit as designed).
- `npm run typecheck`: exit 0. `npm run lint`: clean (`--max-warnings=0`).
- jest over `src/features/pipelines`, `src/features/panels` and `src/features/dashboards/tabs` (maxWorkers 3): 424 suites and
  5966 tests passed.
- `check:schemas`: in sync. `check:helio-mcp-types`: passes. Prettier over every changed ts/tsx/json/md file: clean.

**Acceptance criteria traced to code and behaviour**
- *D and H reproduced first.*
  - H: evidence.md section 1.1 records `Vector(34, 2, 9, 21) did not equal Vector(2, 9, 21, 34)`. Those are the byte offsets of
    spray's TreeMap order. The evaluator independently re-ran D red on base.
  - D's red test (`usePipelineDraftFrames.unfocusedOutput.test.tsx`) exercises the real path. Its fake server answers `rowsStepIds`,
    and base never sends that key, so `s2.rows` is null on base. It is not vacuous.
- *D.*
  - `buildDraftPreviewRequest` sends `rowsStepIds` (`draftPreviewRequest.ts:127-153`). The server emits extra `rows` lines and
    widens `retainOnly` (`DraftPreviewService.scala:199,226-235`), and `mapServerResolved` reads its own map entry
    (`draftStepView.ts:136`).
  - Running app, desktop 1280: with Step 3 selected and "Converted" (node = step 4) displayed, one edit sent exactly 1 POST
    (`rowsStepId`=step 3, `rowsStepIds`=[step 4]). The Output went "live" with the new `note_x` column and no "Select this step" note.
    Switching the Output added exactly one request, as the design allows.
  - Running app, phone 375: the Preview tab resolves against the previewed step. With Step 3 previewed and "Converted" picked, the
    request carried `rowsStepIds`=[step 4] and the Output was live.
  - Request-count equality and the heap bound are measured in evidence.md sections 3 and 4, and the heap shape is re-confirmed in
    my sbt run.
- *E.*
  - Overlay: the `groupedPlot` guard was extracted unchanged into `chartPlotOverlay` (`outputRenderInputs.ts:189`), and
    `ChartOutputPanel` and `LiveOutputRender` both call it.
  - Metric: `selectDraftMetricComparison` reuses `comparisonFrom` and the guards, with a `deltaAndPct` port pinned by a shared
    fixture on both sides.
  - `LATEST <Y>`: computed from `resolveChartPlan`'s order.
  - The parity test asserts an identical overlay and an identical metric trend text.
  - Visually, the live chart and the dashboard panel render the same "vs previous" legend and series styling in dark. The live
    metric shows "▲ 100% vs previous" against the draft value in light.
- *H.*
  - `RowColumnOrder` (VectorMap) is applied on all three rows routes, each with `columns`.
  - The client reads headers from `columns` and cells by header (no `Object.values`).
  - Running app: the wire `columns` for the table Output is `["10","Zeta","date","duration_min","duration_s","note","status"]`,
    which is exactly the Output schema. The saved dashboard table headers start `10, Zeta, date`, the same as the live column's
    headers.
- *Checked in the running app, desktop and phone, light and dark.* I checked it myself (screenshots below). There is no horizontal
  overflow at 375 (`scrollWidth` 375). The only console error is the pre-existing `GET .../schedule` 404 ("no schedule" contract).

**Standing constraints**
- C1: met in code. The PR-body statement is a delivery step and is still owed.
- C2–C6: met. C2 is proven on the raw body by three route specs. C3 uses an unchanged selector. C4 is the last plotted y. C5 and
  C6 are measured and recorded.

**Design judgment**
- No new CSS. The new tile reuses `.live-output__tile` and the comparison reuses `MetricRenderer`'s existing trend markup.
- Light and dark are at parity. The tiles line up at 1280 and 375. The `LATEST DURATION_S` label wraps to two lines at 1280, the
  same way the existing aggregate tiles do.

Screenshots, persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-desktop-dark-d-unfocused.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-desktop-dark-chart-draft.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-dashboard-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-desktop-light-metric-draft.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-phone-light-chart.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/skeptic-phone-dark-chart.png`

No claim here rests on mtime or directory ordering.

### Verdict: CONFIRM

### Non-blocking notes
1. **Owed at delivery (C1).** The PR body must state plainly that the default column order changes for existing panels with no
   column config and no x-axis mapping:
   - charts go from alphabetical to schema order;
   - tables go from natural, case-insensitive sort to schema, then code-point order.

   Because engine-derived schemas are code-point sorted, a user will now see `Zeta` before `date` in a table that used to show
   `date … Zeta`.
2. **Probable follow-up, outside this ticket's Output-column scope, and not introduced by it.** The step-preview `Rows after step N`
   DataGrid shows draft frames in a scrambled order (`10, status, duration_min, duration_s, Zeta, date, note`) while its schema chips
   show `date, status, …`. This was seen for both client-evaluated and server-evaluated steps. It is the literal reading of the
   ticket's original H wording ("draft-preview column order not deterministic"). D7 deliberately left `DataGrid.deriveColumns`
   alone, and the changed modules do not feed that grid.
3. **The truncation flag is lost when a stale frame is shown.** In `draftStepView.ts:143`, `mapServerResolved` sets `truncated`
   from the current transport entry, so it is `false` when the view falls back to `lastGood.rows`. A stale frame that came from a
   truncated `rows` line can then draw the compare overlay. That fails open, which contradicts the "fails closed" intent in
   `LiveOutputBody`. Use `lastGood?.truncated` on that fallback. It is a narrow edge case: the overlay is drawn over a stale frame.
4. **Lenient y parsing.** `latestYAggregate` uses `parseFloat`, which accepts `"12abc"` as 12. `Number()` plus `isFinite` would
   match "numeric y" more strictly.
5. The evaluator's non-blocking notes still stand: the duplicate `orElse(trunkTerminal)` in `DraftPreviewPlanner`, the copied
   identity guard, the silent drop of non-object payload rows, the "code-point" wording (it is UTF-16 code units), and the file-size
   growth.
6. **Dev-DB residue from this review:** user `30aa4604-9e72-42bb-9654-99d8dd879985` (`hel1705-skeptic-*@example.test`) with one
   source, one pipeline and one dashboard. Remove it by id, alongside the evaluator's `be78a8b1-…`.
