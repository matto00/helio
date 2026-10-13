## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `2cbe2391ca5862b012f891a5daebcb6175753651`. Review base: `fd8e8a78c2caaa71b8f645bbc2c4612ea205d408`, resolved live with `resolve-review-base.sh`.

### Gates (my own runs in WORKTREE_PATH)
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test` (HELIO_JEST_MAX_WORKERS=3, nice -n 19): root 49/49 suites, 458 tests. Frontend 582/582 suites, 6923 tests. 0 failures.
- Backend `Test/compile`: sbt loaded `.../HEL-1424/backend/` and printed "compiling 1 Scala source ... test-classes". This shows a test source really was stale. It compiled cleanly. **Orchestrator claim (1) is confirmed.**
- Backend `sbt testFull`: I ran it as the build's own exact partition, HELIO_TEST_SHARD_INDEX=0..5 with HELIO_TEST_SHARD_COUNT=6, -J-Xmx3g, nice -n 19, every shard in the foreground. `TestShards.select` checks that the partition is exact before any test runs. Every shard exited 0, and every hel1468-guard line reported failed=0 aborted=0. Totals: 581 suites, 7644 tests, 0 failed, 4 canceled (pre-existing). The new suites ran and passed: `DataSourceRoutesSpec` "data-source list nullability (HEL-1424)" (3 tests, including the recompiled `Instant.now()` line), `SchemaFieldNullableFormatSpec`, and the inference, refresh, capability and run nullability tests.
- **Claim (2), the executor's "four package slices":** I cannot audit the executor's slicing from what it left behind, because files-modified.md records no slice boundaries or suite counts. My own 6-shard run is complete by construction (it is the build-verified exact partition), so the coverage question is settled by fresh evidence. Advice for later runs: shard with HELIO_TEST_SHARD_INDEX/COUNT instead of package slices, because a hand-picked package list can silently miss a package.

### Phase 1: Spec Review — FAIL
- AC1: met on all four owner-pinned surfaces. I verified it live: the axis reads `east, (blank), west`, the tooltip reads `(blank)`, the Inspect header and button read `(blank)`, the indicator reads `Filtered by team = (blank)`, and a cross-filtered sibling table shows exactly the 2 null rows. HistoryChart is covered by jest.
- AC2: met on the write and read paths. I verified it live: a CSV upload's create response reports `team` nullable true and `amount` false. The stored `outputs.schema` rows for both first-run Outputs carry `"nullable": true` for `team` and `false` for the numeric column, read from the DB.
- AC3: met (`CsvBlankCellsNullSnapshotSpec` adds `SortCast.AsTimestamp`; `CsvBlankCellsNullStepsSpec` asserts `count == 2`).
- Constraints C1 to C4: honoured. C1: the selection and cross-filter value stays `""`, and the PanelCard test asserts `crossFilter.value === ""`. C2: there is no migration, and the per-kind legacy defaults are correct. C3: `git diff --name-only` touches none of TimestampParsing.scala, CastStep.scala or chartTimeAxis.ts. C4: n/a to the code.
- **Issue P1-a: a spec requirement is unverified, and the handoff misstates it.** `specs/stored-schema-nullability` requires that "assistant workspace-context columns for that Output SHALL report the stored value". The main change is at `WorkspaceContextService.scala:395`, but no test asserts it. files-modified.md and the new comment at `WorkspaceContextServiceSpec.scala:288-290` both say the fixture helper "passes `Some(f.nullable)`". The committed helper at `WorkspaceContextServiceSpec.scala:291-292` still reads `fields.map(f => SchemaField(f.name, f.dataType))`, so every fixture field reads the legacy default `true`, whatever `nullable = false` it declares. The suite passes only because no assertion reads `columns.nullable`.
- **Issue P1-b: the planning artifact (the DESIGN.md rule) does not describe the shipped behaviour.** See Change Request 2.

### Phase 2: Code Review — FAIL
- Code quality: clean overall. One shared label module (`utils/blankLabel.ts`) holds the only non-test "(blank)" literal. There are no FQNs and no `any`. The streaming nullability fold does not call `toVector`. `fromCsvLines` skips blank lines with the same predicate as the row loader (`InProcessPipelineEngine.scala:807`). `parseRfc4180Row` trims, so a whitespace-only cell is still blank. The relabel runs after `applyChartOverlay` and before the measuring passes, as designed. The JSON format omits `nullable` when it is `None`, so persisted bytes are unchanged for every non-CSV/Output kind.
- Tests: meaningful. The red-first list in files-modified.md is specific, and the new tests pin the AC scenarios. The exception is P1-a above: a comment says the fixture does something the code does not do, which is a stale or false comment (CONTRIBUTING comment standard).
- Design [mechanical]: the theme.css addition uses no raw values (it only sets `font-style: italic`). The `.mono` class swap is correct.
- **Issue P2-a** = P1-a (code and comment disagree at `WorkspaceContextServiceSpec.scala:288-292`).

### Phase 3: UI Review — PASS (with documentation findings routed to Phase 1)
I used throwaway user `hel1424-eval-1791878637@example.test` (id 39e69857-66b1-4b13-bf5d-bbda4086b1f2). I uploaded a CSV with blank `team` cells, built the first-run dashboard, and then switched the chart Output to client aggregation (`groupBy team, sum`).
- Happy path: the axis label, tooltip, click, Inspect, Filter dashboard and indicator all behave as specified, and the sibling table filters to the 2 null rows. Evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1424/evidence/.playwright-mcp/eval1/agg-chart-dark.png`
  - `.../inspect-dark.png`, `.../crossfilter-dark.png`, `.../indicator-dark.png`
  - `.../indicator-light.png`, `.../inspect-light.png`
- Light/dark: I flipped `data-theme` directly. The indicator placeholder resolves to Schibsted Grotesk italic with `rgb(33,29,25)` text on the light accent tint, and it is readable in both themes. The Inspect button's italic "(blank)" is readable on the accent fill in both themes. (The dashboard panels in `inspect-light.png` stay dark because the attribute flip does not re-theme panel appearance. That is an artifact of my probe, not of the change.)
- Breakpoints: at a width of 375 the indicator measured 335x42 with no overflow, and the 1280 layout was intact.
- Console: no new errors. A 502 on `/api/pipelines/:id/run-events` at about 61 s is an SSE stream timing out through the dev proxy and is unrelated to this diff. The "Can't get DOM width" warnings came from my viewport resize.
- **Orchestrator question (3), the italic, non-monospace placeholder:** I do not consider this a product call beyond the owner's rulings. The owner ruled the label "(blank)" plus a DESIGN.md rule, and the typography follows existing placeholder precedent in the codebase (`DatasetRowGrid.css:58`, `PipelineDetailPage.css:601`, both muted italic placeholders). Any finer visual-cohesion opinion belongs to the skeptic. I did find a mechanical inconsistency that the change creates against its own DESIGN.md text (Change Request 2b). There is also a minor visual gap: the button renders "team =  (blank)" with a wider space than the mono case (italic side bearing plus `{" "}`). That is the skeptic's call.
- Cleanup: I deleted the user by exact (id, email) with `buildUserDeleteSql`. The users, data_sources and outputs counts for those ids are 0. I stopped the servers with `stop-servers.sh` (`STOPPED ports=6856,9763`).

### Overall: FAIL

### Change Requests
1. **`backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala:291-292`**: change the helper to `fields.map(f => SchemaField(f.name, f.dataType, Some(f.nullable)))`, which is what the comment at :288-290 and files-modified.md already claim. Then add one test that sets a stored `Some(false)` field, a stored `Some(true)` field and a legacy `None` field on an Output's schema. It should call `toDataTypeEntry` (or `assemble`) and assert the resulting `WorkspaceContextColumn.nullable` values are `false`, `true` and `true`, which covers the spec requirement "assistant workspace-context columns ... SHALL report the stored value". Record it red-first: mutate `WorkspaceContextService.scala:395` back to `nullable = false` and record the failing test name in files-modified.md.
2. **`DESIGN.md:609-617`, the "(blank)" rule**: make it describe the behaviour that actually ships.
   a. "data grids keep an empty cell" is wrong for the dashboard table panel, which renders a null cell as "—". I saw `<td>—</td>` live, in the table beside the chart. Only the Inspect grid renders an empty cell. Reword it to something like "data grids keep their existing null rendering (the table panel's "—", the Inspect grid's empty cell)".
   b. "In a selection header the placeholder is set in the body face, italic" is not true of the Inspect header. `PanelInspectView.tsx:130-134` builds the header as a plain string, so "(blank)" there is upright, while the button beside it is italic (see `inspect-dark.png`). Either render the header value through a `<span className="selection-value--blank">` like the button, or narrow the sentence to the inline value spans (the cross-filter indicator and the Inspect button).
   c. "A chart category ... is shown as "(blank)", never as "null" or an empty string" contradicts the owner-ruled non-goal (proposal.md: "Non-aggregated charts' blank x label ... unchanged, owner ruling"). The default first-run top-n chart (pipeline-grouped, no client aggregation) still shows an empty x label for the null group (`dash-light.png`, which is actually the dark theme despite its filename). Scope the rule to client-aggregated chart categories and history grouped series, and say that a non-aggregated chart's blank x label is unchanged.

### Non-blocking Suggestions
- `SchemaInferenceEngine.scala:35-36`: the doc comment reads "decodes one line at a time and streaming the nullability fold". Fix the grammar ("and streams the nullability fold over every row").
- In files-modified.md, record how backend coverage was obtained (shard index/count or the package list, and suite totals) so a reviewer can check that it was complete.

### Live probe evidence (AC2)
- POST /api/data-sources create response: `team` nullable true, `amount` nullable false.
- `outputs.schema` (DB): `[{"name":"amount_sum","type":"integer","nullable":false},{"name":"team","type":"string","nullable":true}]`.
