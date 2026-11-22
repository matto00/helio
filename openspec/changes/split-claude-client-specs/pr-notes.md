# HEL-1803 PR notes

Behaviour-preserving split of `ClaudeClient` and three oversized specs. No behaviour fix; no defect found.

## Proof (all under `evidence/`)

- Baseline (`baseline-*`), after the main split (`after-main-comparison.txt`) and after the spec split
  (`after-spec-comparison.txt`): the affected set (39 suites, 484 tests) has identical sorted full test names, an empty
  diff, identical per-name counts; the per-suite redistribution is tabled.
- Full `sbt testFull`, exact-partition shards, COUNT=8 before and after: 10278 tests == 10278 tests
  (`baseline-testfull.txt`, `final-testfull.txt`); suites 759 -> 767 (the eight new spec classes); five canceled
  tests before and after.
- Main split: every logger call stays in `ClaudeClient` (`log-grep-after.txt`: same eight statements, same text and
  order; the two new files have no logger). `main-split-verbatim-check.txt`: the only lines that differ are the new
  file headers and the one `requests` field.
- Spec split: `spec-body-verbatim-check.txt`: every test body line is present, nothing removed; only headers, doc
  comments, repeated `should` subject strings and braces are added.
- DB: no lane DB needed; specs use EmbeddedPostgres and the test JVM gets no `DATABASE_URL` (`db-finding.txt`).

## File sizes (`line-counts.txt`)

| file | lines |
| --- | --- |
| ClaudeClient.scala (was 455) | 254 |
| ClaudeRequestBuilder.scala | 130 |
| ClaudeBlockCodec.scala | 90 |
| ClaudeClientSpec (was 928) / ToolLoopSpec / ToolRequestSpec / FailureBudgetSpec / TestSupport | 225 / 239 / 245 / 175 / 103 |
| AssistantServiceSpec (was 957) / FailureBudgetSpec / SearchRepairSpec / PromptHistorySpec / TestSupport | 206 / 230 / 187 / 246 / 173 |
| AssistantConversationRoutesSpec (was 765) / TurnSpec / TierSpec / Fixture | 172 / 210 / 189 / 280 |

Over ~250:

- `ClaudeClient.scala` (254): design D1 keeps `toContentBlock` (WARNs on the `ClaudeClient` logger), `logHop`,
  `executeTool` and the loop here so no log line changes its logger name; the new files declare no logger.
- `AssistantConversationRoutesFixture.scala` (280): one cohesive embedded-Postgres dual-pool RLS harness plus the
  service wiring, fake transports and route helpers it serves; splitting it would separate the pools from the helpers
  that use them. It is moved verbatim (only `private` dropped).

## Decisions within the design's latitude

- `ClaudeClientSpec` split: the `system`-block tests sit in `ClaudeClientToolRequestSpec` (request shape) and the
  empty-guard test in `ClaudeClientToolLoopSpec`, to keep both under ~250. Support is a trait (`ClaudeClientTestSupport`),
  because the fakes need no actor system but the specs still mix in `HelioRouteTest` for the implicit execution context.
- `AssistantServiceSpec` split: the hop-ceiling and propose-counter tests stayed in `AssistantServiceSpec`
  with the proposal tests, to keep the failure-budget spec at 230 lines.
- `AssistantConversationRoutes*`: each class keeps the original `BeforeAndAfterAll` lifecycle and starts its own
  EmbeddedPostgres in `beforeAll` (three instances instead of one; measured per-class cost is the extra start-up).
  Checked deliberately for the skeptic's note: every test calls `cleanDb()` and every usage/tier/budget test seeds its
  own fresh user via `newUserWithTier`; the shared `ownerA`/`ownerB` rows are `owner` tier and never counted, so no
  test depends on `assistant_daily_usage` rows left by an earlier block. All three classes pass.
