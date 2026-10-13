## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `21e514395d59330219e1da8db6d5ade4d16e57f1`. The review base was resolved live with `resolve-review-base.sh` and is `fd8e8a78c2caaa71b8f645bbc2c4612ea205d408` (exit 0).

### What I verified (with evidence)

**Ground truth and scope**
- The diff is `git diff fd8e8a78c...HEAD`: 50 files. I read the code changes in full: backend main, the frontend non-test files, DESIGN.md and theme.css.
- C3 holds. TimestampParsing.scala, CastStep.scala and chartTimeAxis.ts do not appear in the diff.
- C2 holds. The diff adds no migration file.
- `origin/main` is two commits ahead (HEL-1502 #985 and HEL-1534 #987). `git merge-tree --write-tree HEAD origin/main` merges cleanly, and no file touched by this branch overlaps theirs.

**AC1: the "(blank)" label on the four owner-pinned surfaces, with null-matching unchanged**
- Code:
  - `utils/blankLabel.ts` is the only non-test "(blank)" literal.
  - `buildChartOption.ts:276-281` relabels after `applyChartOverlay`, gated on `plan.source === "aggregate" && hasNullGroup`.
  - `chartClickSelection.ts:153` maps "(blank)" plus `groupHasNull` to `""`.
  - `HistoryChart.tsx` relabels grouped rows and the "vs" overlay together.
  - `CrossFilterIndicator.tsx` and `PanelInspectView.tsx` (header and button) use `selectionValueLabel`.
  - Redux values are untouched (C1).
- Live: throwaway `hel1424-skeptic-1791881214@example.test`, worktree servers on 6856/9763. CSV `team,amount,notes` with two blank `team` rows; first-run dashboard; the chart Output switched to client aggregation (`groupBy team, sum`). I read every screenshot myself.
  - Category axis reads `east, (blank), west`, and the tooltip reads "(blank) 5". Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1424/evidence/.skeptic-final/dash-default.png`.
  - Clicking the (blank) bar opens Inspect with header "Showing rows for team: (blank) / sum(amount_sum)", button "Filter dashboard by team = (blank)", and the grid's null row. Screenshot: `.../after-click-dark.png`.
  - Clicking Filter dashboard shows the indicator "Filtered by team = (blank)". The sibling table narrows to exactly the 2 null-team rows (amount 2 and 3), so HEL-1408's null-matching is intact. Screenshot: `.../crossfilter-dark.png`.
  - Light theme, same flow, via the real ThemeProvider (`helio-theme=light` plus reload): `.../inspect-light.png`, `.../crossfilter-light.png`.
  - Output history after a re-run: the grouped point's stored series is `["null",5.0]` (read from `/api/outputs/:id/history`), and the history chart shows `east, (blank), west`. Screenshot: `.../history-light.png`.
- Unit coverage read: `buildChartOption.blankCategory.test.ts` covers vertical, horizontal and pie, the literal "null" case, the overlay landing at the (blank) index, and clicks per orientation.

**AC2: stored nullability**
- Code:
  - `SchemaField.nullable: Option[Boolean]`. The format writes the field only when it is `Some`, and reads a missing or non-boolean value as `None`.
  - `fromCsvLines` streams over every row (`lines.filter(_.trim.nonEmpty)`, no `toVector`). `parseRfc4180Row` trims, so a whitespace-only cell counts as blank. That is consistent with the row loader (`InProcessPipelineEngine.scala:807-809`).
  - `inferShallowFromJsObjects` sets `nullable = presentNonNullCount < objects.size`.
  - The CSV create, URL-create and refresh paths, plus the Output run and backfill paths, all write `Some`. `upsertSourceDataType` writes `Some` only for CSV.
  - Read defaults are per kind: CSV `true`, other kinds `false`, Outputs `getOrElse(true)`.
- Live:
  - Create response: `team: true, amount: false, notes (all blank): true`. The `GET /api/data-sources` list returns the same values.
  - DB `outputs.schema` holds `{"name":"notes","type":"string","nullable":true}` and `team` true / `amount` false for both Outputs, and `amount_sum` false / `team` true for the chart Output.

**AC3**
- `CsvBlankCellsNullSnapshotSpec` covers `SortCast.AsTimestamp`.
- The `CsvBlankCellsNullStepsSpec` lookup test asserts `count(_("team") == null) shouldBe 2` (diff read).

**Gates (fresh, my own runs)**
- jest on the 10 affected areas (3 workers, nice 19): 25 suites, 413 tests, 0 failed.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0.
- `sbt testOnly` of the 9 touched backend specs: 450 tests, 450 succeeded, 0 failed. sbt loaded `.../HEL-1424/backend/`, confirmed from its "loading project" line.
- Full-suite evidence: I rely on evaluation-2.md's pasted 6-shard `testFull` breakdown (581 suites, 7645 tests, 0 failed). It is specific and unambiguous, and the cycle-2 delta since that run is test-only plus a doc comment.

**Console**
- Every error is residue from an earlier session's stopped backend (`ERR_CONNECTION_REFUSED` for pipeline `1ae96486…`), a pre-login 401, or a 404 on `/schedule` (no schedule set). None comes from this change.

**Cleanup**
- The user was deleted by exact (id, email) via `buildUserDeleteSql`. Counts afterwards: users/data_sources/outputs = 0/0/0.
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=6856,9763`).

### Design-gate note 2: the italic "(blank)" placeholder, settled

I accept it in both themes.
- **Readability:** the italic body face reads as copy rather than a data value. It is legible on the accent-tint indicator and on the solid-accent Inspect button in light and dark.
- **Precedent:** it matches existing italic placeholder treatments: `.pipeline-detail-page__root-column-empty` and `.dataset-row-grid__cell-pending`.
- **Colour:** it sensibly does not borrow their muted colour, which would cost contrast on the accent button.
- **Header:** the Inspect header is a plain sentence string and renders "(blank)" upright. DESIGN.md:609-621 now says so explicitly, so the minor in-modal mismatch is documented, not accidental.
- **Product scope:** this is a presentation detail inside the owner's "(blank)" ruling, not a new product call.
- **Chart axes:** they render "(blank)" in the chart's existing axis face, consistent with sibling labels.

### Verdict: CONFIRM

No assumed product call beyond the owner's four rulings was found.

### Non-blocking notes
- The 8px gap between "=" and the italic "(blank)" in the Inspect button comes from the button's `display:flex; gap:8px` (measured). The same gap applies to the pre-existing mono value span, so this change did not introduce it.
- The live history "vs" overlay was not exercised end to end: my comparison point was rows-mode, from before the aggregation switch. The aligned-overlay behaviour is covered by `HistoryChart.blank.test.tsx` and the `buildChartOption` overlay test.
- evaluation-1.md is committed on the branch. That is hygiene only and harmless.
