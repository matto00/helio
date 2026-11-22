## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `c26ce6c2770b7f5d8820c456e4e6787d74038d2a` (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-claude-client-specs/HEL-1803`.
- **Artifacts read in full:** ticket.md, proposal.md, design.md, tasks.md; origin plan
  `archive/2026-11-20-assistant-failure-budget-loop/pr-notes.md` ("Follow-up" section). D1/D2 follow that plan.
- **Round-1 CR 1 (logging method moved out) is resolved against the tree.** `grep -n "log\."` on ClaudeClient.scala
  hits lines 52, 55 (`send`), 118, 121 (loop), 192, 199 (`logHop`), 235 (`executeTool`), 272 (`toContentBlock`).
  D1 now keeps all four of those owners in `ClaudeClient`, lists `toContentBlock` explicitly with the 272 reason,
  forbids any logger in the new files, and requires the before/after `grep` record. The Risks bullet and tasks.md
  C2 / 2.1 match. `toContentBlock` is called only at ClaudeClient.scala:130 (the loop), as D1 says.
- **D1 method partition is complete and its dependencies resolve.** Every method in ClaudeClient.scala (grep of
  `def`/`val`) is assigned to exactly one file. Cross-file calls work: the loop calls `prepareHop`,
  `guardrailRejectTool`, `requestedId` (builder) and `addUsage`, `noAnswer`, `extractText` (codec, lines 129-147);
  `send`/`stream` call `guardrailReject`, `toApiRequest` (builder) and `toClaudeResponse` (codec);
  builder→codec: `toApiToolRequest`→`toApiContentBlock`, `guardrailRejectTool`→`flattenForEstimate`; codec-internal:
  `toClaudeResponse`→`noAnswer`. Config-dependent methods (`requestedId`, `wireTemperature`, `buildTools`,
  `toApi*Request`, guardrails) go to the config-holding class; the codec methods use no `config`.
  `PreparedHop` is `private[ai]` (ClaudeHistoryNormalizer.scala:11), so the builder may return it.
- **No test reaches the moved privates.** `grep -rn "invokePrivate|PrivateMethod|getDeclaredMethod|wireTemperature"`
  in backend/src outside ClaudeClient.scala: no hits.
- **Logger-capture tests are unaffected by D1:** ClaudeClientSpec.scala:197 (`client.getClass`),
  ClaudeModelRequestSpec.scala:101/122 (`classOf[ClaudeClient]`) all still attach to the logger that every WARN/INFO
  stays on.
- **Size estimate is plausible:** the moved range is roughly lines 205-212, 239-249, 276-455 plus `requestedId`
  (~200 lines), leaving `ClaudeClient` near 255, as D1 states and pre-commits a PR-notes reason for.
- **D2 matches the real spec structure:** ClaudeClientSpec subjects at 72/212/316; helpers at 30-70 and 242-313
  (all `private`, including `FakeToolTransport`/`FakeToolExecutor` classes), so the trait-vs-object note is apt.
  AssistantServiceSpec: `converse` 183-940 and `AssistantProtocol.assistantTools` 943; helpers 48-182, repository is a
  Mockito mock (no DB). AssistantConversationRoutesSpec: `BeforeAndAfterAll` only, EmbeddedPostgres in `beforeAll`
  (89), `afterAll` (163), `cleanDb` (TRUNCATE assistant_conversations) called per test, six subject blocks at
  293/433/501/564/610/702 that D2's grouping covers. D2 requires the subject string repeated verbatim, which keeps
  every full test name unchanged.
- **D3 proof design is sound:** exact-partition env shards (round-1 note folded in as C1), same COUNT before/after,
  sum comparison, sorted full-name diff, redistribution table, verbatim-body check. Task 4.3 now uses
  `resolve-review-base.sh` instead of bare `main` (round-1 note folded in).
- **AC coverage:** AC1 (budget or stated reason) → D2 targets + task 4.2; AC2 (same count) → D3 + tasks 1.2/4.1.
  No scope drift: non-goals fence off HEL-1802's files, `AskDataService`, `ClaudeHistoryNormalizer`. No API/schema
  change, so no spec delta (`skip_specs: true`) is correct.
- **No placeholders:** no TODO/TBD; the remaining executor discretion (exact file boundaries, trait vs object,
  moving a non-logging method between the two new files) is bounded by stated limits and recording requirements.

### Verdict: CONFIRM

### Non-blocking notes

- AssistantConversationRoutesSpec shares `ownerA`/`ownerB` and `assistant_daily_usage` rows across tests (only
  `assistant_conversations` is truncated per test). Tests in a budget/tier block may depend on usage left by an
  earlier block in the same class. Splitting by block can change that; D2/D4 already require the executor to keep
  lifecycle and to report (not fix) any such dependency. Worth checking deliberately when choosing the boundaries.
- D3.3 "per assertion-bearing test name the count is identical" is redundant with the empty sorted-name diff;
  harmless.
- `private` → `private[ai]` applies to the codec methods the client now calls (`addUsage`, `noAnswer`,
  `extractText`) as well as the builder's; D1's general rule covers it.
