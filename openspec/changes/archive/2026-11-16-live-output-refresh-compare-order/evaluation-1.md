## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `bcf8691dbd9abdcd01a2a181251566975a769047` against base `0c699d2633e5dedbc14cb3bddaca6147dd6b6025` (resolved live with
`resolve-review-base.sh`). 105 files changed, +3275/-202. Two commits.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC "D and H reproduced first": D re-proven red by this evaluator (below). H red is recorded in evidence.md §1.1, and the
  positions it quotes (`Vector(34, 2, 9, 21)`) are exactly the byte offsets of `[{"10":1,"alpha":"a","extra":true,"zeta":"z"}`,
  which is spray-json's TreeMap order. The figures are self-consistent. I did not re-run them, because the base worktree has no
  backend env and I was barred from touching `.env`.
- D: one paced request carries `rowsStepIds` = [displayed node], and the server emits one `rows` line per id. The request count is
  unchanged (evidence §3 plus a mutation check). The heap bound holds: a new `extra-ids` shape peaks at 42.2 MB, and the maximum over
  12 shapes is 74.6 MB, under 96 MB. The `DraftPreviewHeapSpec` assertion passed in my `sbt testFull` run.
- E: `chartPlotOverlay` is extracted from `ChartOutputPanel` and shared, so the overlay code is unchanged (C3). The metric delta uses
  a `deltaAndPct` port, asserted against `shared-test-fixtures/delta-and-pct.json` from both Scala and jest. `latestYAggregate` reads
  the last plotted point through `resolveChartPlan`'s order (C4). The parity test asserts identical overlay and comparison output.
- H: `RowColumnOrder` (VectorMap-backed) is applied on all three rows routes, each with `columns` (C1). The client reads headers from
  `columns`, and cells are read by header rather than with `Object.values`. Three raw-body route tests cover it (C2).
- Every task is ticked and matches the diff. Schemas, CLAUDE.md, the `draftPreviewClient.ts` comment and the spec deltas match the
  behaviour as built. No scope creep. CONSTRAINTS C1–C6 are honoured in the diff. C1's "PR states the default column-order change"
  is a delivery step that has not happened yet; see the suggestions.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (logs in `/home/matt/Development/helio/.concertino/scratch/HEL-1705/eval/`):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test`: root 66 suites / 579 tests, frontend 771 suites / 9472 tests, all passed (jest maxWorkers 3).
- `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt -J-Xmx3g testFull`: `Tests: succeeded 9550, failed 0, canceled 5`, "All tests passed", no `*** FAILED` lines.
  The HEL-1705 specs ran and passed: three wire-order route tests, the rowsStepIds stream tests, the heap shape, and the public-response key guard.
- Also run: `check:schemas`, `check:openspec`, `check:scala-quality` (clean apart from soft warnings), `check:e2e-types`,
  `check:helio-mcp-types`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup`, `check:tokens`. All clean.

C6 independent check (D red): I put the committed `usePipelineDraftFrames.unfocusedOutput.test.tsx` into a throwaway worktree
detached at base, with node_modules hardlinked from the main checkout. Removed afterwards. Results:
- As committed, the test does not compile on base (`TS2353: 'outputNodeStepIds' does not exist`).
- With `// @ts-nocheck` prepended, the D test fails at the same assertion evidence.md quotes: `expect(s2?.rows).not.toBeNull()`,
  `Received: null`. The request-count test passes on base, which is expected because it is an equality guard; its red comes from the
  recorded mutation.
- So the red is real, but "recorded on the unmodified tree" is not literally true for the committed file. See the suggestions.

Code-quality review:
- No inline FQNs. The new Scala imports are top-of-file. No `any` and no new escape hatches.
- No CSS changes. `check:tokens` resolves every var.
- No dead code, TODOs or FIXMEs.
- The new modules are small and composable: `RowColumnOrder`, `columnOrder.ts`, `deltaAndPct.ts`, `useDisplayedOutputNodeIds`, `resolvePreviewStepId`.
- Errors at the boundaries: an extra id with no outcome yields an `available: false` line. Decoder 400s cover >8 ids, duplicates,
  unknown ids and non-strings. All are tested.
- Security: on the public rows route, `columns` lists only schema names, which public viewers already get through the Output meta.

### Phase 3: UI Review — PASS
Ran on the worktree's servers via `start-servers.sh` (7137/10044) with a freshly registered eval user and the same seed shape as the
lane's e2e. Persisted evidence (durable refs):
- `/home/matt/Development/helio/.concertino/runs/HEL-1705/evidence/.concertino/scratch/HEL-1705/eval/desktop-dark-chart.png`:
  the chart Output at 1280 in dark has a "vs previous" legend entry and a `LATEST DURATION_S 351` tile.
- `.../desktop-dark-d-unfocused.png`, D at 1280 in dark: Step 3 selected, "Converted" (node = step 4) displayed, one edit. An
  in-page fetch recorder saw exactly 1 POST, with `rowsStepId` = step 3 and `rowsStepIds` = [step 4]. The Output showed "live", with
  no "Select this step to update it", and the new `note_md` column appeared after the schema columns.
- `.../desktop-light-metric.png` and `.../desktop-light-metric-draft.png`, the metric at 1280 in light: "0% vs previous" before the
  edit, then "▲ 100% vs previous" after the expression was changed to `/30` (10.18 against a baseline of 5.09). The delta is
  measured from the draft value, as D4 specifies.
- `.../desktop-light-chart.png`: the chart overlay legend and LATEST tile in light.
- `.../phone-light-chart.png`, `.../phone-dark-chart.png`, `.../phone-dark-output.png`: the 375 Preview tab in light and dark. An
  explicit pick of the non-focus "Run duration" Output renders the chart, the overlay legend and the `LATEST DURATION_S 351` tile.
  `scrollWidth` is 375, so there is no horizontal overflow.
- `.../desktop-dark-dashboard-table.png`: the saved dashboard table headers equal the rows response `columns` and the Output
  schema. This is weak evidence for H, because the engine derives schemas alphabetically. The route specs carry the H proof.
- At 1100 and 768: no horizontal overflow, and the Output section collapses to its disclosure at narrow desktop widths, as designed.
- Console: the only error is `GET /api/pipelines/:id/schedule` 404, which is the existing "no schedule" contract and not part of
  this change. No unhandled exceptions.

### Overall: PASS

### Non-blocking Suggestions
- evidence.md §1.2 says the red was "recorded on the unmodified tree". The committed test does not type-check there (TS2353 on
  `outputNodeStepIds`). Say how the red was run, for example with the prop added to the type only, or with type-checking off.
- `DraftPreviewPlanner.scala:60-61` computes `req.rowsStepId.orElse(trunkTerminal(req))` twice. Bind it once.
- `metricHistoryView.ts:201` repeats the identity guard from line 152 instead of extracting it. D4 said "extracted, not copied".
  It is one line, so this is minor.
- `OutputHistoryService.scala:77` silently drops any non-object payload row while `rowCount` stays unchanged. Real payloads are
  always objects, but a comment or a WARN would make the drop explicit.
- `RowColumnOrder.scala:15` and `columnOrder.ts` say "code-point" but compare UTF-16 code units. The two sides agree, and they only
  differ for astral-plane characters. Fix the wording.
- These files were already over the ~400-line budget and grew: `panelsSlice.ts` (540), `usePanelData.ts` (416),
  `panelThunks.ts` (413) and `panel.ts` (506). Per CONTRIBUTING.md, propose a split in the PR description.
- C1: the PR body must state plainly that panels with no column config and no x-axis mapping change their default column order.
  Charts go from alphabetical to schema order, and tables go from natural sort to schema order.
- Residue: the evaluation registered dev user `be78a8b1-62f4-47ae-aa29-419a11b15d88` (`hel1705-eval-*@example.test`), with one
  pipeline and one dashboard. It needs the usual id-based cleanup.
