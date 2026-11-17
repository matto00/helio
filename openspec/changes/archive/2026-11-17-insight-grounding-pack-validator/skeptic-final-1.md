## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e1553817d2c040422f92b0de5b20f482bc696b2a` against the live-resolved base
`2e98eba9287d61a47957129f1f097ea039125d92` (`resolve-review-base.sh`, exit 0). Every file in the diff is an add
(`git diff --name-status` shows no M/D lines), so ClaudeClient, ClaudeRequest, ClaudeModels, Main, ApiRoutes and the
Flyway migrations are untouched.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ... branch=feature/insight-grounding-pack-validator/HEL-1741`.
- **Not wired (C2):** a grep of `backend/src/main` finds `ClaudeInsightClient`/`InsightRenderer`/`InsightContextBuilder`
  only in their own files. There is no migration, no `insight` OutputKind reference, and the inputs are plain types
  (`InsightInputs`).
- **Fresh baseline:** `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.insights.* com.helio.services.insights.*
  com.helio.infrastructure.ai.ClaudeInsightClientSpec"` gave `Tests: succeeded 48, failed 0`, both before the
  mutations and after the restore.
- **Full suite:** I relied on the evaluator's pasted `testFull` output (`succeeded 9630, failed 0, canceled 5`). The
  diff is add-only, so the pasted output is unambiguous and I did not re-run the suite.
- **I re-ran one mutation per AC myself, each run isolated and followed by `git checkout -- backend/src/main`.** Logs
  are in `.concertino/scratch/HEL-1741/skeptic-*.log`:

  | AC | Mutation | Red |
  |---|---|---|
  | Fabricated number rejected | `InsightValidator.scala:97`: `numbers.exists(near) \|\| day \|\| year` -> `true` | 8 failed, including validator "a reason naming the numeral" and renderer "rejected by the renderer" |
  | Injected instruction stays inside the data block | `serialize`: `<`/`>`/`&` escaping removed | 1 failed: "keep an injected closing delimiter ... inside it" |
  | Pack within budget (ClaudeTokenEstimator) | `build`: `val estimate = 0 * estimator(...)` | 4 failed: `18856 was not <= 8000`, and the irreducible-pack renderer test failed with `expected PackTooLarge, got Accepted` (zero-call proof) |
  | No credential/connection fields | extra `"connection" -> "jdbc:postgresql://h/db"` pack key | 2 failed: allow-list and content tests |
  | Fake client only / wire shape | `ClaudeInsightClient`: `webSearch = true` | 1 failed: wire test |

  My first budget mutation (`if (true) Right`) did not compile because of `@tailrec`. I replaced it with the compiling
  variant above. That was a measurement issue, not a code defect.
- **Owner ruling D1 (shared CLAUDE_MODEL):** `ClaudeInsightClient` reports `client.modelId`. The spec asserts that the
  wire `model` and the response model equal the configured `claude-haiku-5-5`.
- **Owner ruling D2 (caps):** `InsightLimits(8000, 400, ...)`. The adapter clamps to `min(request, 400)`, and the
  "never exceed 400" spec sends 4000 and gets 400 on the wire. Cost is `InsightPriceTable.costMicros` (BigDecimal,
  HALF_UP) and is only recorded: no outcome branches on cost.
- **Price table "read from the source":** I loaded https://platform.claude.com/docs/en/about-claude/pricing myself
  (a docs page, not a model call). All five entries match the live table exactly (input/output/5m-write/hit):
  - opus-4-8: 5/25/6.25/0.50
  - haiku-5-5: 0.10/0.50/0.125/0.01 (prompts up to 100k tokens)
  - sonnet-5-5: 2/10/2.50/0.10
  - opus-5-5: 4/20/5/0.20
  - sonnet-5: 2/10/2.50/0.20

  The evaluator could not check this; it is now verified.
- **Owner ruling D9 (reject, keep last good, retry once):** `InsightRenderer.attempt` retries only when
  `retryNote.isEmpty`. `Rejected`/`Failed`/`PackTooLarge` carry no new text, plus `lastGood` unchanged. The spec shows
  2 calls and `lastGood == previous`. A model failure does not retry, which matches D9: the retry is for citation
  rejections.
- **Design D1-D9:** I read all eleven main files against design.md:
  - D1 seam: sealed failures and the `Unavailable` default.
  - D3 citations: traversal order is compares, windows, head. Numeric-string cells are cited with the original string
    kept inline.
  - D4 escaping: applied to the whole serialized pack, so column keys, output names and labels are covered too. The
    custom prompt and the retry note are sanitized to a fixpoint.
  - D5 shedding order: halve rows, then drop the oldest ~1/8 of points, then empty windows, then compares from the
    end. `PackTooLarge` is returned before any call.
  - D6 preset precedence.
  - D7 numeral, date, ordinal and year rules, with the sign dropped.
  - D8 retry note re-estimated against the budget.
  - D9 price source and date.
  - The implementation matches the design.
- **No live model call (C13):** I made none. All specs use `FakeClient` or `RecordingToolTransport`.

### Verdict: CONFIRM

### Non-blocking notes

- Validator holes beyond the documented number-words limit, for L4 to track against the live reject and accept data:
  - Java `\d` is ASCII-only, so non-ASCII digits (fullwidth `９９９`, Arabic-Indic) are never scanned.
  - A leading-dot decimal (`.5`) is read as `5`.
  - Any 1-31 integer passes when the sentence cites a date, because D7 matches it to the day of month. A fabricated
    count such as "14 orders" can pass next to a cited 2026-11-14.

  All three are design-sanctioned or exotic, so none blocks this leaf.
- Dropping the sign means a stated direction is never checked: "rose 12%" against a pct of -12.4 is accepted. This
  matches D7, but it is a meaning-level gap L4 should know about.
- `Failed` reports `Some(0L)` cost for a call that may have been billed (the evaluator noted this too).
  `HopBudgetExhausted` usage is discarded.
- `InsightFixtures.scala:3` has a redundant same-package import.
- `evaluation-1.md` is untracked in the change dir. That is the orchestrator's housekeeping, not this diff.
