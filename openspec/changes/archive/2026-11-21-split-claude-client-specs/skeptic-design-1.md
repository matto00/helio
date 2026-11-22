## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `c26ce6c2770b7f5d8820c456e4e6787d74038d2a` (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-claude-client-specs/HEL-1803`.
- **Size claims hold:** `wc -l` gives ClaudeClient.scala 455, ClaudeClientSpec 928, AssistantServiceSpec 957,
  AssistantConversationRoutesSpec 765, the same figures proposal.md and design.md give.
- **Origin plan:** pr-notes.md:65-66 in the archived assistant-failure-budget-loop change says "move the failure-budget
  and input-stop tests into their own spec files, and the tool-loop helpers out of `ClaudeClient`". D1/D2 follow it.
- **D1 method inventory against ClaudeClient.scala (all 455 lines read):** every method D1 names exists, and so does
  `PreparedHop` (`private[ai]`, ClaudeHistoryNormalizer.scala:11), so it can be built from a sibling file. The
  dependencies between the planned files resolve: `guardrailRejectTool`→`flattenForEstimate`,
  `toApiToolRequest`→`toApiContentBlock`, `toClaudeResponse`→`noAnswer`. Estimated sizes after the move: ClaudeClient
  about 230, the request builder about 130, the codec about 110.
- **Logging check, which fails:** `toContentBlock` (ClaudeClient.scala:250-274) logs. Line 272 is
  `log.warn(s"Preserving an unmodeled Claude content block of type '$other' verbatim")` on the `ClaudeClient` logger.
  See Change Request 1.
- **Log-capture tests:** ClaudeClientSpec.scala:197 (`getLogger(client.getClass)`, the API-key no-leak test) and
  ClaudeModelRequestSpec.scala:101 (`getLogger(classOf[ClaudeClient])`, which includes
  `appender.list...filter(WARN) shouldBe empty`) both attach to the ClaudeClient logger. No test asserts on the
  unmodeled-block WARN text (`grep "unmodeled Claude"` finds no test hits).
- **Spec structure (outlined by grep):** ClaudeClientSpec has subjects `ClaudeClient.send` (72), `.stream` (212) and
  `.sendWithTools` (316-928). Its helpers are spread through the file (lines 28-70 and 242-313) and it mixes in
  `HelioRouteTest`. AssistantServiceSpec has `converse` (183-940) with the HEL-1637 block at about 326-500 and
  `AssistantProtocol.assistantTools` (943). The routes spec uses `BeforeAndAfterAll`, gets an EmbeddedPostgres in
  `beforeAll` and has six subject blocks. D2's boundaries match these real blocks. D2's "subject string repeated
  verbatim" rule keeps every full test name unchanged.
- **Sharding and new suite names:** build.sbt:219-255. Local hash grouping takes any class. With
  `HELIO_TEST_SHARD_INDEX/COUNT` set, TestShards gives an unlisted suite the median weight (TestShards.scala:65-66), so
  new spec classes need no edit to `test-suite-weights.tsv` (HEL-1797 added none either).
- **OpenSpec:** `.openspec.yaml` has `skip_specs: true`, and `openspec validate split-claude-client-specs` printed
  "Change 'split-claude-client-specs' is valid". A spec delta is correctly absent: there is no API or schema change.
- **AC coverage:** AC1 (file budget) is covered by D2's ~250/400 rule and task 4.2. AC2 (same test count) is covered by
  D3 and tasks 1.2/4.1. The non-goals exclude sibling lane HEL-1802's files.

### Verdict: REFUTE

### Change Requests

1. **D1 moves a logging method out of `ClaudeClient` while saying no logging moves.** design.md D1 puts
   `toContentBlock` in `ClaudeBlockCodec`, which it calls a `private[ai] object` of "pure conversions with no config".
   It also says `ClaudeClient` keeps "every method that logs (`logHop`, `executeTool`)", that the executor "may not
   move logging ... out of `ClaudeClient`", and (Risks) "Logger name: kept by D1 (no logging leaves `ClaudeClient`)".
   But `toContentBlock` logs: ClaudeClient.scala:272 sends a WARN to the `ClaudeClient` logger for an unmodeled block
   type. As written, D1 cannot be followed literally. An implementer could:
   (a) give the codec its own logger, which changes the WARN's logger name, a change visible in production JSON logs
   and one the design forbids;
   (b) drop the WARN, which is a behaviour change;
   (c) leave `toContentBlock` in `ClaudeClient`, which contradicts the D1 list.

   Outcome (a) would also hollow out the ClaudeModelRequestSpec.scala:101 check
   (`filter(WARN) shouldBe empty` on the `ClaudeClient` logger) for this WARN, without any test going red.

   Revise D1 (and task 2.1) to pick one option and say so explicitly. Two options keep behaviour:
   - Keep `toContentBlock` in `ClaudeClient` and add it to the "every method that logs" list. ClaudeClient then lands
     around 255 lines; record that in the PR notes.
   - Have the codec log through `LoggerFactory.getLogger(classOf[ClaudeClient])`, so the logger name stays the same.

   Whichever you choose, correct the "every method that logs" list so it is complete. Fix the Risks bullet to match.

### Non-blocking notes

- **D3.1/D3.4 sharding:** the repo already has an exact-partition shard mechanism. `HELIO_TEST_SHARD_INDEX` /
  `HELIO_TEST_SHARD_COUNT` (build.sbt:234-249, verified exact before any test runs) partitions every defined suite.
  Package-glob shards could silently leave a suite out of both the baseline and the final run, so the sums would match
  without the run being a full `testFull`. Prefer the env shards, or record the union of shard suites against
  `definedTests`.
- **Task 4.3** says `git diff --stat main...HEAD`. Per CON-152 the base should be the one `resolve-review-base.sh`
  returns, not a bare `main`.
- **D2, ClaudeClientSpec support:** `FakeClaudeTransport` and the other fakes live inside a class that mixes in
  `HelioRouteTest`. If any of them closes over `system`/`mat`, a support `object` will not compile; a trait will.
  This is already left to the executor ("trait or object"). Noted so the choice is made on purpose.
- **AssistantConversationRoutesSpec:** each new class will start its own EmbeddedPostgres in `beforeAll`. That is
  expected, but note the extra suite-setup time in the PR.
- **Proposal wording:** proposal.md says "sibling file(s)", while design.md commits to exactly two. These agree, with
  the design being more specific.
