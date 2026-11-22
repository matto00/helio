## Context

`ClaudeClient.scala` is 455 lines; `AssistantServiceSpec` 957, `ClaudeClientSpec` 928,
`AssistantConversationRoutesSpec` 765. None changed since HEL-1637 (3b9f4c83d). CONTRIBUTING.md: ~250 lines per source
file soft budget; a file past ~400 needs a split. HEL-1797 (c26ce6c27) is the template: baseline counts recorded and
committed first, a split commit that touches no assertion, code moved verbatim.

## Goals / Non-Goals

Goals: every touched or new file at or under ~250 lines (or a stated reason in the PR); identical behaviour; identical
test set (same full test names, same assertions), proven by committed before/after records.

Non-goals: any behaviour fix (a defect found becomes a follow-up via triage); any change to callers outside
`com.helio.infrastructure.ai` and the three spec files; `AssistantConversationService` /
`AssistantConversationRepository` (sibling lane HEL-1802); `AskDataService` (HEL-1745); `ClaudeHistoryNormalizer`
(HEL-1636 thinking handling) other than unchanged call sites.

## Decisions

### D1 — Main split: three files, by responsibility

- `ClaudeClient.scala` keeps the public surface (`modelId`, `send`, `stream`, `sendWithTools` and its `loop`) and every
  method that logs: `logHop`, `executeTool`, and `toContentBlock` (its unmodeled-block branch, ClaudeClient.scala:272,
  WARNs on the `ClaudeClient` logger; it is called only from the loop), plus `rejectedOncePerResponse` /
  `OncePerResponseMessage` (loop policy). Keeping `toContentBlock` here puts `ClaudeClient` at roughly 255 lines; that
  is the stated reason recorded in the PR notes if it lands over ~250.
  Its logger stays `LoggerFactory.getLogger(getClass)` on `ClaudeClient`, so no log line changes its logger name.
- `ClaudeRequestBuilder.scala` — `private[ai] final class ClaudeRequestBuilder(config: ClaudeConfig)`: the
  config-dependent request shaping: `requestedId`, both `wireTemperature` overloads, `prepareHop`, `buildTools`,
  `toApiToolRequest`, `toApiRequest`, `guardrailReject`, `guardrailRejectTool`. `ClaudeClient` holds one instance
  built from its own `config`.
- `ClaudeBlockCodec.scala` — `private[ai] object ClaudeBlockCodec`: pure conversions with no config and NO logger:
  `toApiContentBlock`, `addUsage`, `extractText`, `flattenForEstimate`, `noAnswer`,
  `toClaudeResponse`.

Moved method bodies and their doc comments are byte-identical except: the `private` modifier becomes `private[ai]`
(or public within the `private[ai]` type) where a sibling now calls it, and a call site gains the owner prefix
(`requests.prepareHop(...)`, `ClaudeBlockCodec.toApiContentBlock`). `[[addUsage]]`-style scaladoc links are adjusted to
resolve. No reordering of evaluation inside any method. The executor may move a method between the two new files if
it measures a better fit for the budget, recording why in the PR notes; it may not move any method that logs, or loop
logic, out of `ClaudeClient`, and neither new file declares a logger. Before the move, `grep -n "log\." ClaudeClient.scala`
is recorded in evidence and every hit must still be in `ClaudeClient` afterwards.

Rejected alternative: moving the `sendWithTools` loop itself into a `ClaudeToolLoop` class. It is the code HEL-1637
and HEL-1745 depend on, it logs, and splitting the loop from `send` would change the logger and the ownership of the
`transport`; the helpers are the dead weight, not the loop.

### D2 — Spec split: by `should` block, shared fixtures to support files

Each split keeps the WordSpec subject string exactly (`"ClaudeClient.sendWithTools" should { ... }` repeated in the new
file), so every full test name `<subject> should <title>` is unchanged. Test bodies are moved verbatim.

- `ClaudeClientSpec` (928): keep `send` + `stream` (~240). The fakes live inside a class mixing in `HelioRouteTest`;
  if any closes over `system`/`mat` the support must be a trait, not an object (executor's deliberate choice); new `ClaudeClientToolLoopSpec` (sendWithTools core:
  hops, executor errors, usage, guardrail, system); new `ClaudeClientToolRequestSpec` (web_search and cache-breakpoint
  shape tests); new `ClaudeClientFailureBudgetSpec` (the HEL-1637 block, per the pr-notes plan). The private
  helpers they share (`toolUseResponse`, `finalTextResponse`, block builders, the recording transport / executor
  classes, `config`, `toolRequest`) move to a test-only `ClaudeClientTestSupport` (trait or object) in the same test
  package, verbatim.
- `AssistantServiceSpec` (957): split the `converse` block into cohesive files: the HEL-1637 failure-budget /
  hop-ceiling / input-stop tests -> `AssistantServiceFailureBudgetSpec`; `searchedWithNoResults` + dangling-tool_use
  repair -> one file; system-prompt / fullHistory / transport-error / web_search tests -> one file; proposal capture
  tests and the `AssistantProtocol.assistantTools` block stay in `AssistantServiceSpec`. Shared helpers to
  `AssistantServiceTestSupport`.
- `AssistantConversationRoutesSpec` (765): DB-backed; its fixture (DB context, users, `cleanDb`, transports,
  `routesFor*`) moves to a support trait; split by top-level `should` block, e.g. converse persistence + errors;
  idempotency key + turn-outcome signals + after-hop-cap; tier gating + budgets (HEL-1637). Each new class must keep
  the original's lifecycle (BeforeAndAfter / per-test cleanup / RLS context) exactly; a shared DB setup that was
  once-per-class must still be correct when run once per new class.

Exact file boundaries are the executor's measurement call within these lines; target every file at or under ~250
lines, hard ceiling 400 for any file that must keep a cohesive block together, with the reason recorded for the PR.

### D3 — Proof of an unchanged test set

1. Baseline first (C12), before any code moves, on `main` + evidence only:
   - Run the affected spec set: the three spec files plus every spec in `infrastructure/ai` and `services/assistant`
     and `api/routes/assistant`, plus `services/ask` (ask loop) and the other `sendWithTools` callers' specs
     (`grep -rl "ClaudeClient\|sendWithTools" backend/src/test`). Record per-suite counts AND the sorted list of full
     test names (`<subject> should <title>`) per suite, as `.txt`, committed under the change's `evidence/`.
   - Run the full `sbt testFull` using the repo's exact-partition shards (`HELIO_TEST_SHARD_INDEX` /
     `HELIO_TEST_SHARD_COUNT`, build.sbt:234-249), never package-glob shards (a glob shard could miss a suite in both
     runs). Choose a COUNT high enough that each shard finishes under the 600 s Bash timeout (one api shard once took
     668 s); use the same COUNT for the final run. Record each shard's `Total number of tests run` and suites completed,
     plus the sums. Commit as `.txt`. (New suite classes get the median weight, so after-split shard membership may
     differ; only the sums are compared.)
2. After the main split (no test file changed): same affected-set run, identical per-suite counts.
3. After the spec split: same affected-set run; the multiset of full test names across the affected set is identical
   to baseline (a committed `diff` of the sorted name lists, empty), and per assertion-bearing test name the count is
   identical. Per-suite counts differ only by redistribution, and the redistribution table is committed.
4. Final full `sbt testFull` in the same shards; the sum equals the baseline sum. Commit.
5. A mechanical check that bodies moved verbatim: for the main split, a committed script/transcript showing each moved
   method's body text (normalised for indentation and the owner prefix only) equal to the baseline's; for specs, the
   sorted set of test-body lines equal before/after (ignoring indentation). Any difference is explained line by line.

### D4 — Verbatim discipline

No assertion text, fixture value, timeout, or ordering inside a test changes. Imports are trimmed only to what each
file needs (`check:scala-quality`: no inline FQNs). If a move exposes a real defect (e.g. a test that only passed due
to shared mutable state between tests in one class), stop and report it: it is a follow-up, not a fix in this change.

## Risks / Trade-offs

- **Shared mutable state across tests in one class**: splitting a class can change which tests share a fixture
  instance. Mitigated by D3 (all green, identical names) and by keeping per-test setup verbatim.
- **DB-backed route spec**: more classes means more per-class DB setup; forked test groups (HEL-924) may place them on
  different JVMs. Run on the lane-private DB; any flake that appears only after the split is investigated, not
  retried away.
- **Logger name**: kept by D1: every method that logs (`logHop`, `executeTool`, `toContentBlock`) stays in
  `ClaudeClient`; the new files declare no logger. ClaudeClientSpec.scala:197 and ClaudeModelRequestSpec.scala:101
  attach to the `ClaudeClient` logger and keep meaning what they meant.
- **Route spec suite setup**: each new `AssistantConversationRoutes*Spec` class starts its own EmbeddedPostgres in
  `beforeAll`; the extra setup time is noted in the PR.

## Migration Plan

None (no wire, schema or data change).
