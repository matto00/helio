## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- **AC #1** (`cache_control` breakpoints on the stable prefix for both `send` and `sendTool`):
  addressed. `ClaudeClient.toApiToolRequest` marks the last `tools` element and the last content
  block of the first message (`ClaudeClient.scala:166-188`); `toApiRequest` marks the first message
  (`ClaudeClient.scala:229-239`). Verified at the wire-serialization level in
  `HttpClaudeTransportSpec.scala` (new `buildHttpRequest(ClaudeApiRequest)`/`(ClaudeApiToolRequest)`
  tests asserting `cache_control` lands on exactly the last `tools` element and the first message's
  last block, nowhere else) and at the builder level in `ClaudeClientSpec.scala` (new "mark the last
  tools element and the first message's last content block" / "mark the first message with a cache
  breakpoint" tests), matching spec deltas' "sendTool marks the tools array and the first turn" /
  "send marks the system-prompt-carrying first message" scenarios exactly.
- **AC #2** (multi-hop `cache_read_input_tokens` surfaced in logged usage): addressed end-to-end.
  `ClaudeApiUsage`/`claudeApiUsageFormat` parse the two cache counters absent-tolerantly
  (`ClaudeProtocol.scala:67-78`), `ClaudeClient.addUsage` sums all four counters across hops
  (`ClaudeClient.scala:137-144`), and `AssistantTelemetry.emitToolLoopOutcome` appends both fields
  (`AssistantTelemetry.scala:53-54`). `AssistantTelemetrySpec.scala`'s new "a multi-hop turn's
  telemetry line shows a nonzero, correctly-aggregated cacheReadInputTokens" test drives a real
  4-hop `/converse` call through stubbed usage and asserts the emitted record's
  `cacheReadInputTokens` = "200" (4 × 50) — this is the "multi-hop tool-use turn shows nonzero
  cache_read_input_tokens in logged usage" AC, proven at CI level via the request/parse/aggregate/log
  chain. Design.md D6 explicitly (and, per skeptic-design-1/2, correctly) scopes the *live* nonzero
  observation against the real Anthropic caching backend as post-deploy — not achievable in CI — and
  that framing is unchanged and reasonable.
- **AC #3** (zero conversation behavior/output change): addressed. Every wire model's `cacheControl`
  field defaults to `None`; `ClaudeProtocolSpec.scala` and `HttpClaudeTransportSpec.scala` both assert
  byte-identical serialization for the unmarked case. The one deliberate wire-shape difference — the
  cache-marked first message's `content` becoming a one-element `text` block array instead of a plain
  string — is explicitly called out in design.md D2 as semantically equivalent (the Messages API
  accepts string-or-block-array content interchangeably) and is the only such change; no other
  domain-level behavior drift found in the diff (checked all non-2-arg-default `TokenUsage(...)`
  call sites in `RefinementService`/`DashboardAuthoringService`/`ClaudeSseFrameParser` — all compile
  and behave unchanged via the new fields' defaults, consistent with the proposal's stated non-goal
  of not extending `AuthoringTelemetry`/other authoring paths in this ticket).
- All 14 tasks in `tasks.md` are checked and each one's implementation was independently verified
  against the diff (not taken on the executor's word) — no task claims an artifact that isn't
  actually present.
- No scope creep: diff touches only `com.helio.ai` (`ClaudeWireModels`, `ClaudeProtocol`,
  `ClaudeClient`, `ClaudeModels`, `HttpClaudeTransport`) and `com.helio.services.AssistantTelemetry`,
  plus their tests and the change-dir's own planning docs — exactly the proposal's stated Impact.
  `AssistantConversationRoutes.scala`/`AssistantService.scala` are untouched, consistent with the
  design's claim that no service/route-layer change is needed.
- No regression to existing behavior: full `sbt test` run (3120 tests) passes, including the updated
  `ClaudeClientSpec` "wire model/max-tokens/temperature/messages through" fixture (task 4.6) that the
  design's own Risks section flagged would otherwise break under D3's unconditional first-message
  marking — confirmed fixed and passing.
- API contracts: none affected — `TokenUsage` has no spray formatter and never reaches an HTTP
  response (independently re-confirmed: `grep -rn "TokenUsage"` finds no formatter and
  `AssistantConversationResponse` has no `usage` field). No `schemas/` changes needed or made.
- Planning artifacts reflect final implemented behavior: `proposal.md`/`design.md`/spec deltas match
  the diff with no drift; both skeptic-design rounds' change requests (CR1: fixture update + spec
  delta MODIFIED-requirement) are present and correctly implemented (task 4.6,
  `specs/claude-api-client/spec.md:29-44`).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates (fresh run, this evaluation, in `WORKTREE_PATH`)**:
- `cd backend && sbt test` → **3120 tests, 0 failed** (195 suites, all green; ~2m28s).
- `npm run lint` → clean (zero ESLint warnings/errors).
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → **186 + 1875 = 2061 Jest tests, all passed** (helio-mcp + frontend suites).
- `npm run check:schemas` → in sync (61 protocol checks, 7 enum surfaces).
- `npm run check:scala-quality` (CONTRIBUTING.md pre-commit gate; run in addition to the assigned
  list since it's the canonical mechanical enforcer for the Imports & Qualifiers rule and file-size
  budget) → exit 0, "clean" with only pre-existing soft (informational, not hard-fail per
  CONTRIBUTING.md) file-size warnings. No inline-FQN hard violations in any changed file.
- `npm run check:openspec` → reports "complete but not archived", exactly the known pre-archive
  state called out in the task brief — not a defect.

**Canonical standards (`CONTRIBUTING.md`)**:
- Imports & Qualifiers: no inline FQNs in any changed file (`check:scala-quality` mechanical check,
  clean). `ClaudeWireModels.scala` explicitly imports `spray.json.JsValue` at the top; no inline
  package-qualified references introduced.
- File-size soft budget: `ClaudeClient.scala` grew from 224 → 262 lines (over the 250-line soft
  budget by 12 lines); `ClaudeClientSpec.scala` grew to 554 lines (already well over budget
  pre-change, extended further); `AssistantTelemetrySpec.scala` reached 270 lines. All three are
  **soft/informational only** per CONTRIBUTING.md's own text ("File-size warnings ... are
  informational only") and `check:scala-quality`'s exit-0 "clean" result — flagged below as a
  non-blocking suggestion, not a mechanical violation.
- Per-domain JSON formatters live under `com.helio.api.protocols` per CONTRIBUTING.md — not
  applicable here; `ClaudeProtocol` is a pre-existing `com.helio.ai`-scoped trait unrelated to the
  `JsonProtocols` aggregator pattern, and this change only extends existing formatters in place.
- `HttpClaudeTransport.buildHttpRequest(ClaudeApiRequest)` widened `private` → `private[ai]`
  specifically and only to mirror the pre-existing `ClaudeApiToolRequest` overload's visibility
  (confirmed both are `private[ai]` post-change) — a minimal, justified, package-scoped widening for
  testability (design.md D6), not a broader API surface leak.
- Design-standard [mechanical] rules: N/A — no `frontend/**` files changed.

**DRY / Readable / Modular / Type safety**:
- The last-element-marking pattern (`init :+ last.copy(cacheControl = ...)`, guarded on `Seq()`) is
  applied identically at three call sites (`tools`, tool-path first message, `send`/`stream` first
  message) — small, self-contained, not extracted into a shared helper. This is a reasonable judgment
  call given the three sites differ in shape (`Seq[ClaudeApiTool]` vs. `Seq[ClaudeApiContentBlock]`
  vs. a single `ClaudeApiMessage`); flagged as a non-blocking suggestion only.
  `ClaudeApiCacheControl`/`Ephemeral` avoids duplicating the marker literal across three write sites.
- No untyped escape hatches (`Any`/`asInstanceOf` outside tests, which use it idiomatically for
  `JsArray`/`JsObject` field extraction in test assertions only).
- Doc comments are thorough and each links back to a specific design.md decision (D1-D6), matching
  the existing file's established comment-density convention.

**Security / Error handling**: no new input-validation or injection/XSS surface — this is an
outbound-request-shaping and response-usage-parsing change only, no new external input path. Parse
errors are handled the same absent-tolerant way as the pre-existing `input_tokens`/`output_tokens`
fields (`.map(_.convertTo[Int]).getOrElse(0)`), consistent with the existing idiom — no silent
failure introduced beyond what the codebase already accepts for this field family.

**Tests meaningful / No dead code / No over-engineering**:
- New tests exercise real regression-catching assertions: exact placement of `cache_control` (not
  just presence), byte-identical serialization for the unmarked case, absent-vs-present cache-counter
  parsing, cross-hop aggregation arithmetic, and an actual end-to-end multi-hop `/converse` telemetry
  assertion. These would catch a real regression (e.g. marking the wrong block, or double-counting
  hops).
- No leftover TODO/FIXME/unused imports found in the diff.
- No premature abstraction — `ClaudeApiCacheControl` is the minimal shape needed (a `String`-carrying
  case class per design.md D1's rationale for not using a bare `Boolean`, since Anthropic's own API
  value is an object with room for future TTL variants).

**Behavior-preserving**: this is additive, not a structural refactor, except for
`claudeApiMessageFormat`'s move off `jsonFormat2` to a hand-written format — verified
behavior-preserving for the unmarked case (byte-identical test) and the one deliberate,
explicitly-flagged wire-shape change (marked case) is the ticket's own explicit goal, not a
drive-by change.

### Phase 3: UI Review — N/A

No `frontend/**`, `schemas/**`, `openspec/specs/**` (top-level active specs), or
`backend/src/main/scala/routes/ApiRoutes.scala` files changed (`git diff main...HEAD --name-only`
confirms zero matches against any Phase 3 trigger). This is a pure backend wire-protocol +
telemetry change with zero frontend surface, consistent with the ticket's own scope note ("Pure
backend wire-protocol change — no schema/frontend/database impact, no migration"). No dev-server
startup or Playwright session was run, per the task brief's explicit instruction for this change.

### Overall: PASS

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/ai/ClaudeClient.scala` is now 262 lines, past the 250-line soft
  budget (`npm run check:scala-quality`, informational only). Consider extracting the two
  breakpoint-marking helpers (mark-last-tool-and-first-message-block for `toApiToolRequest`,
  mark-first-message for `toApiRequest`) into small private functions if the file grows further —
  not required now.
- `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` (554 lines) and
  `backend/src/test/scala/com/helio/api/routes/AssistantTelemetrySpec.scala` (270 lines) are also
  over the soft budget; both were already large before this change (456 and ~230 lines respectively)
  and this change added focused, non-duplicative test cases rather than driving the growth — a future
  split (e.g. a `ClaudeClientCacheSpec`) would be reasonable but is not this ticket's concern.
