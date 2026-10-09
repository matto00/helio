## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `78fd8575a04806c7f84b301749000f3244418783`. Diff base (live-resolved): `3d63a1751bcfd09595943ce390f8f10678e44e49`.
Cycle-2 delta reviewed: `f5725f6b..78fd8575`. It touches:
- `ConvertFormatStep.scala` (whitespace only)
- `CsvBlankCellsNullStepsSpec.scala`
- `ChartOutputPanel.aggregate.test.tsx`
- a new `release-note.md`
- the committed `evaluation-1.md`

There are no frontend source changes, and the backend main code changed only in whitespace.

### Fresh gate runs (evaluator's own)

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run typecheck` | pass |
| `npm test` (`--maxWorkers=3`, nice 19) | pass: 477 suites, 5028 tests (+1 vs cycle 1) |
| `npm --prefix frontend run build` | pass |
| `cd backend && sbt testFull` (nice 19) | pass: **6361 run, 0 failed**, 455 suites, 0 aborted (+1 vs cycle 1) |

### Verification of each cycle-1 change request (mutations re-run by the evaluator in a throwaway detached worktree at `78fd8575`, removed afterwards)

- **CR1 (upsert optional numeric, red by accident)**: RESOLVED.
  - The test now loads `id,n\n1,\n2,\n` through `loadCsv` and converts with the spec's `toRow`, which is `PipelineRowJson.anyToJsValue`, the production conversion. It asserts `Right(Vector(Vector(JsNull), Vector(JsNull)))`.
  - With D1 reverted, it fails **at the assertion**: `Left(Vector("row 0: field 'n' — expected integer, got string", ...)) was not equal to Right(...)` (`CsvBlankCellsNullStepsSpec.scala:242`). It no longer fails on a test-side exception.
- **CR2 (release note)**: RESOLVED. `openspec/changes/csv-blank-cells-as-null/release-note.md` covers every item task 4.1 lists:
  - D1 rules
  - every D7/D7b row, including the alert-baseline step
  - D10, including its scope beyond CSV, public/PAT `/rows` `eq ""`, the mixed null+`""` Inspect case and the literal-`"null"` case
  - Q1-Q8
  - `= ""` compat and `is null` guidance
  - AI-step null-as-empty
  - snapshots keep `""` until the next run
  - fillnull/coalesce guidance

  I checked it against design.md and found no inaccurate claims.
- **CR3 (lookup half of the join/lookup row)**: RESOLVED.
  - The new `LookupStep` case runs over two `loadCsv` frames. It asserts that the null-key rows get `BLANK` and the `a` rows get `A`.
  - With D1 reverted, it is red at `:187` (`Set() was not equal to Set("BLANK")`).
- **CR4 (ConvertFormatStep indentation)**: RESOLVED. `ConvertFormatStep.scala:57-59` is aligned with the sibling `case` arms, and the double space is gone. The diff is whitespace only.
- **Suggestion (strict `=== null`)**: ADDRESSED.
  - The new Jest case uses absent-key records with no null and asserts `groupHasNull: false`.
  - With `ChartOutputPanel.tsx` mutated to `== null`, exactly that test goes red (1 failed / 13 passed in `ChartOutputPanel.aggregate.test.tsx`). Without the mutation, all 14 pass.

Claim not verifiable from artifacts: the executor says the CR1 mutation "is recorded". No mutation output appears in `files-modified.md`, `tasks.md` or the run evidence dir. That claim stays unverified. The substance is covered by my own re-run above.

### Phase 1: Spec Review — PASS

All three ACs are met:
- **Red-first:** reproduced by mutation in cycle 1. The ordering limitation noted in evaluation-1 still applies.
- **Regression suite:** every D7/D7b row now pins its new value deliberately.
- **Release note:** present.

Every task is ticked, and each now matches an artifact. There is no scope creep, and the CONSTRAINTS hold: C2 is now satisfied with no hand-mapped rows, and C3 is satisfied by `testFull`.

### Phase 2: Code Review — PASS

The cycle-2 delta introduces no inline FQNs, dead code or new escape hatches. The tests are meaningful, as the mutation results above show.

### Phase 3: UI Review — PASS

`frontend/**` triggered this phase, but only a test file changed this cycle. There are no frontend source changes (`git diff f5725f6b..HEAD -- frontend/src ':!*.test.*'` is empty), and the backend changed only in whitespace. The cycle-1 end-to-end results therefore still apply:
- the blank-category cross-filter on a CSV-sourced client-aggregated chart
- a sibling table narrowed to the blank rows through server `eq ""`
- metric count 4
- no console errors
- 1440/768/375 without overflow

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/hel1408-eval1-chart.png`, `/home/matt/Development/helio/.concertino/runs/HEL-1408/evidence/.playwright-mcp/hel1408-eval1-blank-crossfilter.png`.

Re-checked this cycle:
- `assert-phase.sh servers` → PASS.
- `GET :6840/api/outputs/eb44fd6e-1797-4885-8c1f-a8b8a09cfa9e/rows?filter={"ops":[{"column":"team","op":"eq","value":""}]}` returns exactly the 2 null-team rows.

No new dev-DB rows were created this cycle.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- These cycle-1 suggestions are still open:
  - `CsvBlankCellsNullSnapshotSpec` `eq ""` could add `SortCast.AsTimestamp`, to back its "every cast" name.
  - The trailing comments in the `FilterStepSpec` block restate assertions.
- If the executor wants its mutation results counted as recorded, persist them in `files-modified.md` or the run evidence dir.
- The CR3 lookup case goes red under the D1 revert only through the `team == null` filter. An extra assertion such as `out.count(_("team") == null) shouldBe 2` would make what it is testing explicit. This is optional.
