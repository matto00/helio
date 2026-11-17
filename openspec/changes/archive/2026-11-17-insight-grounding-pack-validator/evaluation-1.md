## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e1553817d2c040422f92b0de5b20f482bc696b2a` against the live-resolved base `2e98eba9287d61a47957129f1f097ea039125d92`
(origin/main). The diff adds 11 main and 7 test Scala files plus the change dir. It modifies no existing file.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC "fabricated number rejected": `InsightValidator` (D7) is tested at the validator and the renderer level
  (`InsightValidatorSpec` "a fabricated number", `InsightRendererSpec` "a fabricated number"). Both are failable:
  the recorded mutation `if (true) true` turns them red.
- AC "injected instruction stays inside the data block": `InsightContextBuilder.serialize` escapes `<`, `>` and `&`
  after compact printing (D4). The test asserts exactly one open and one close delimiter, that the instruction text is
  absent outside the block, and that the parsed JSON round-trips the original value. Removing the escaping gives two
  close tags, so the test turns red. Delimiter tokens are removed from the custom prompt and the retry note to a
  fixpoint (`InsightPrompts.sanitize`).
- AC "pack within input-token budget": the estimate is `ClaudeTokenEstimator` over system and user (D5). Shedding
  order is head halving, then oldest window points, then whole windows, then compares. An irreducible pack returns
  `PackTooLarge` and the client is called zero times. The retry note is re-estimated and dropped when over budget.
- AC "no source credential/connection fields": `InsightInputs` cannot hold a source at the type level, and the test
  asserts its declared fields. A key allow-list guard walks citations, compares, windows, head and rows. The recorded
  mutation (an extra `sourceConfig` key) turns it red.
- AC "fake client only": all specs use `FakeClient` or `RecordingToolTransport`. `ClaudeInsightClient` is not wired
  into Main, ApiRoutes or any trigger (grep confirms there are no references outside its spec). No live call.
- Driver constraints: no Flyway migration, no change to ClaudeClient, ClaudeRequest or ClaudeModels, and no
  `insight` OutputKind dependency. All C1-C4 constraints are honored.
- The tasks are all checked and match the files. `files-modified.md` is accurate.
- Judgement calls the executor noted, checked against design and spec:
  - Head carries a cited `capturedAt` and a `rowCount`. This is consistent. The spec requires "every date-valued cell
    or capture time" to be cited, and D3 names the `headRowCount` citation. `InsightPack.HeadKeys` lists both.
  - Head rows are `{rank, data}`. D3 requires each row's 1-based position to be cited (`field: "rank"`) and does not fix
    the shape. This is acceptable, and `RowKeys` allow-lists it.
  - `InsightRenderer` renders `Auto` as `Summary`. D8 does not cover it, and D6 inference needs node signals the
    renderer is not given. This is documented in the scaladoc (`InsightRenderer.scala`, `render`). Acceptable.
  - `Failed` carries usage 0 and cost `Some(0)`. This is not a spec violation. The design's Risks section accepts
    that "a failed call records zero usage; flagged for L4's cost ledger", and `ClaudeToolOutcome.Failed` carries no
    usage to report. The spec's "unknown model -> no cost" rule concerns price-table lookup, and is honored (an
    `Accepted` from an unknown model carries `None`). `Some(0)` is a lower bound presented as an exact value, though:
    a refusal (`ClaudeClient.scala:131`) is billed but would record $0. See Non-blocking Suggestions.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH (backend-only diff, so the frontend gates do not apply):
- `nice -n 19 sbt -J-Xmx3g testFull`: `Tests: succeeded 9630, failed 0, canceled 5, ignored 0` ("All tests passed",
  exit 0). The 5 canceled are pre-existing opt-in measurement specs. All 6 new specs ran (InsightPresetAndPriceSpec,
  InsightRendererSpec, InsightContextBuilderSpec, InsightValidatorSpec, InsightInputAdaptersSpec,
  ClaudeInsightClientSpec). The two `FAILED` grep hits in the log are test names, not failures.
- `npm run check:scala-quality`: clean. No inline FQNs. The largest new file is 205 lines, under the 250 budget.
- `check:openspec`, `check:spec-structure`, `check:no-credential-leak` and `format:check` all pass.

Code checks:
- Layering: `domain/insights` imports no infrastructure type. The estimator is injected as `Seq[String] => Int`, and
  the infrastructure-backed estimator lives in `services/insights/InsightRenderer`, as D5 specifies.
- `ClaudeInsightClient` matches D1: `tools = Nil`, `maxHops = 0`, `webSearch = false`, `system = Some(...)`, and
  `maxTokens` clamped to 400. Every `ClaudeError` variant is mapped, so the match is exhaustive. The wire spec
  asserts the recorded JSON over a fake transport.
- Price table: the 5-minute cache-write prices are consistently 1.25x input. The values match the D9 table. I could
  not re-verify them against the live pricing page because this review has no web access, so I judged them against
  the design only.
- Fail-first (C12/C3): each recorded mutation in `fail-first.md` targets the exact code path its proof depends on, and
  each would deterministically turn the named assertion red (I checked this by reading the code, without re-mutating,
  since this role modifies no code). The specs were written after the implementation, and recorded mutation-to-red is
  the accepted form for that case.

### Phase 3: UI Review — N/A
No file under `frontend/**`, `schemas/**`, `openspec/specs/**` or `ApiRoutes.scala` changed. The new spec lives
only in the change dir.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `InsightRenderer.scala`: `render` starts with `priorCost = Some(0L)`, and `Failed` returns that value. On a
  first-call failure, the outcome claims an exact cost of $0, even for a billed refusal. Two ways to make this honest
  for L4's ledger:
  - Document on `InsightRenderOutcome.Failed` that `usage` and `costMicros` exclude the failed call and are a lower
    bound.
  - Or return `None` when the failing call's usage is unknown.
- `ClaudeInsightClient.scala`: the `HopBudgetExhausted(_, _)` arm drops a usage value the API did report. With
  `tools = Nil` this is near-unreachable, but `InsightModelFailure` has no usage channel to carry it.
- `InsightContextBuilder` `headJson`: `headRowCount` cites `h.rows.size` (all rows passed in), not the rows kept
  after shedding. This is defensible, since it is the head's true size, but it is worth a one-line scaladoc so L4 knows
  what "rows" the model may state.
- `InsightFixtures.scala:3`: the `import com.helio.domain.insights.InsightLimits` is redundant, because the file is in
  the same package.
- `backend/relative/path/` is an empty, untracked directory in the worktree (mtime 11:11). It is probably a test-run
  artifact, not part of this diff. It does not need fixing here.
