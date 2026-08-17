## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold, not from evaluation-1.md/skeptic-design narratives):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md`, both spec deltas,
  `evaluation-1.md`, `skeptic-design-1.md`, `skeptic-design-2.md`, `workflow-state.md` in full.
- `git log --oneline -1` → `94f19d62 HEL-699 Add Anthropic prompt-cache breakpoints to the assistant
  tool-use loop`, matches the commit named in the task brief.
- `git diff main...HEAD --name-only` → exactly 6 backend main files (`ClaudeClient.scala`,
  `ClaudeModels.scala`, `ClaudeProtocol.scala`, `ClaudeWireModels.scala`, `HttpClaudeTransport.scala`,
  `AssistantTelemetry.scala`), 4 backend test files, and the change-dir's own docs. Zero
  `frontend/**`, `schemas/**`, `helio-mcp/**` files touched — confirms the proposal's stated Impact
  and rules out scope creep.
- Read every changed main-source file's full diff (`git diff main...HEAD -- <file>`) and the full
  current content of `ClaudeWireModels.scala` and `ClaudeClient.scala`.

**AC #1 (cache_control breakpoints on the stable prefix, both `send` and `sendTool`) — traced to real code:**
- `ClaudeClient.toApiToolRequest` (`ClaudeClient.scala:170-195`) marks `apiTools.last` and
  `messages.head`'s last content block, each guarded on `Seq()`.
- `ClaudeClient.toApiRequest` (`ClaudeClient.scala:231-245`), shared by `send`/`stream`, marks
  `messages.head`, guarded on `Seq()`.
- Verified `AssistantService.seedHistory` (`AssistantService.scala:99-106`): when `history.isEmpty`
  (turn 1 of a conversation), the single new message's content is
  `danglingIds.map(...) :+ ClaudeContentBlock.Text(AssistantSystemPrompt.text + "\n\n" + message)` —
  the system-prompt-carrying `Text` block is provably the LAST block of the first (and only) message,
  so D3's "mark the last block of the first message" lands exactly where the design claims.
- Wire-level proof: `HttpClaudeTransportSpec.scala`'s two new test groups
  (`buildHttpRequest(ClaudeApiToolRequest)`/`(ClaudeApiRequest)`) serialize a request through the
  real `ClaudeProtocol` writers and assert `cache_control` on exactly the last `tools` element + the
  first message's last block (tool path) and the first message only (send path) — read in full,
  matches the spec's "sendTool marks the tools array and the first turn" / "send marks the
  system-prompt-carrying first message" scenarios verbatim.

**AC #2 (multi-hop nonzero `cache_read_input_tokens` in logged usage) — chain traced end to end, live observation correctly scoped post-deploy:**
- `ClaudeApiUsage`/`claudeApiUsageFormat.read` parse `cache_creation_input_tokens`/
  `cache_read_input_tokens` absent-tolerantly (`ClaudeProtocol.scala:59-78`).
- `ClaudeClient.addUsage` (`ClaudeClient.scala:137-143`) sums all four counters across hops.
- `AssistantTelemetry.emitToolLoopOutcome` (`AssistantTelemetry.scala:53-54`) appends both fields.
- `AssistantTelemetrySpec.scala`'s new "a multi-hop turn's telemetry line shows a nonzero,
  correctly-aggregated cacheReadInputTokens" test drives a REAL `POST /:id/converse` call (not a
  unit-level shortcut) through a stub transport that returns `cache_read_input_tokens = 50` on every
  hop, captures a real `LogstashEncoder` JSON log line, and asserts `cacheReadInputTokens == "200"`
  (4 hops × 50). I independently re-derived the "4 hops" arithmetic: the sibling
  hop-cap-exhausted test in the same file documents 4 round trips for this exact fixture shape
  (`"unknown_tool"` never resolves, driving the loop to the 3-hop cap, i.e. 4 total transport calls) —
  the cache-read test reuses that same shape, so 4 × 50 = 200 is correct, not a fudged number.
- This is a genuine end-to-end proof of the request/parse/aggregate/log chain. The live nonzero
  observation against the real Anthropic caching backend is correctly out of CI's reach (no live API
  key, no deterministic cache-hit reproduction) — design.md D6 states this explicitly and both
  skeptic-design rounds already accepted that framing as honest, not evasive. I agree: CI proves
  everything that is provable in CI; the remaining half of the AC is a post-deploy telemetry
  observation, which is what the ticket's own AC #2 phrasing ("shows nonzero... in the logged usage")
  actually asks to be *verifiable*, not necessarily *verified pre-merge*.

**AC #3 (zero behavior change) — verified, not merely asserted:**
- Every new field defaults `None`/`0`; `ClaudeProtocolSpec.scala` asserts byte-identical serialization
  for `ClaudeApiMessage`/`ClaudeApiContentBlock`/`ClaudeApiTool` in the unmarked case (read in full).
- The one deliberate wire-shape change — a cache-marked message's `content` becoming a one-element
  `text` block array instead of a plain string — is exactly what design.md D2 calls out, is exactly
  what `HttpClaudeTransportSpec`'s "carry the first-message block-array cache_control marker" test
  exercises, and is semantically a no-op per the Anthropic Messages API (string-or-block-array content
  are interchangeable). No other domain-level change found while reading every hunk of the diff.
- Checked every non-cache-aware `TokenUsage(...)` construction site still on disk
  (`DashboardAuthoringService.scala:336,373,427`, `RefinementService.scala:166`,
  `ClaudeSseFrameParser.scala:63`, `ClaudeClient.scala:117`) — all are pre-existing 2-arg calls that
  compile unchanged and default the two new fields to 0. Noted as a non-blocking observation below
  (not a defect): the `stream`/authoring/repair paths' own `TokenUsage` construction does not forward
  cache counters even though those paths DO send a cache-marked first message and DO read the cache on
  repeat calls per design.md's own Risks section — but this is an explicit, twice-reviewed non-goal
  ("No `AuthoringTelemetry` extension for the `send` path"), not a violation of AC #2 (which is
  scoped to the assistant tool-use loop) or AC #3 (no behavior change — this is only an unrealized
  observability opportunity, not incorrect behavior).

### Spec-delta traceability (claude-api-client, assistant-tool-loop-telemetry)

- `claude-api-client` ADDED requirement scenarios ("sendTool marks the tools array and the first
  turn", "send marks the system-prompt-carrying first message", "Unmarked requests serialize
  unchanged") each map 1:1 to a real, passing test in `HttpClaudeTransportSpec.scala`/
  `ClaudeProtocolSpec.scala` (verified above, not taken on the delta's word).
  "Cache counters absent from the API response default to zero" / "Cache counters aggregate across
  tool-loop hops" map to `ClaudeProtocolSpec.scala`'s absent-parse test and `ClaudeClientSpec.scala`'s
  new "aggregate cache-read and cache-creation input tokens across hops" test (read in full — two
  hops with `cacheCreationInputTokens=100`/`cacheReadInputTokens=0` then `0`/`100`, asserted summed to
  `100`/`100`).
- `claude-api-client` MODIFIED "Existing single-shot send and stream are unaffected": read the CURRENT
  active base spec (`openspec/specs/claude-api-client/spec.md:246-253`) and confirmed the delta
  (`specs/claude-api-client/spec.md:29-44`) faithfully reproduces the original requirement text before
  appending the superseding sentence, and rewrites the scenario from the now-false "every existing
  test passes unmodified" to "every test passes, with the sole permitted modification that expected
  built requests now carry the first-message cache marker." Verified this against the actual code: the
  ONLY exact-request-equality fixture in the whole `com/helio/ai` test tree
  (`grep -rn "shouldBe Some(ClaudeApi" backend/src/test/scala/com/helio/ai/`) is
  `ClaudeClientSpec.scala:84-92`'s "wire model/max-tokens/temperature/messages through" test, and its
  `git diff` (task 4.6) shows the expected `ClaudeApiMessage` updated to carry
  `cacheControl = Some(ClaudeApiCacheControl.Ephemeral)` — exactly the one permitted modification the
  MODIFIED scenario describes, nothing else changed in that fixture. `openspec validate
  assistant-prompt-caching --strict` → "Change 'assistant-prompt-caching' is valid" (re-ran myself,
  not trusted from skeptic-design-2's claim).
- `assistant-tool-loop-telemetry` MODIFIED requirement's new scenario "A multi-hop turn's record shows
  nonzero cache reads" → the `AssistantTelemetrySpec.scala` test discussed under AC #2 above. The
  requirement's other three pre-existing scenarios (turn emits outcome record, hop-cap-exhausted
  reflected, message text never recorded) are untouched by the diff and still pass per the fresh
  `sbt test` run below — confirmed no regression to what the base spec already promised.

### Design-gate integrity (D1–D6)

- D1 (`ClaudeApiCacheControl` case class, not Boolean, default-`None`): `ClaudeWireModels.scala:11-21`
  matches exactly.
- D2 (writers append only when set; `claudeApiMessageFormat` hand-written, byte-identical when
  unmarked): `ClaudeProtocol.scala` diff matches exactly; verified by test.
- D3 (breakpoints placed in `ClaudeClient`'s builders, not services/transport; last-tools +
  last-first-message-block for `sendTool`, first-message for `send`/`stream`): `ClaudeClient.scala`
  diff matches exactly, both guarded on non-empty as specified.
- D4 (cache counters ride the existing usage path end to end, 4-field `addUsage`,
  `toClaudeResponse` maps them): matches exactly.
- D5 (telemetry: two new fields on the existing event, nothing else): `AssistantTelemetry.scala` diff
  is exactly the two-line addition D5 describes.
- D6 (verification strategy incl. the `ClaudeClientSpec` fixture update, task 4.6): task 4.6 is
  checked in `tasks.md`, the fixture update is present and correct (verified above), and
  `HttpClaudeTransport.buildHttpRequest(ClaudeApiRequest)` was correctly widened `private` →
  `private[ai]` (confirmed in the file, matching the pre-existing `ClaudeApiToolRequest` overload's
  visibility) — no undisclosed deviation from the confirmed design found anywhere in the diff.

### Gates re-run fresh, this review (all commands run by me, in `WORKTREE_PATH`)

- `cd backend && sbt test` → **3120 tests, 0 failed, 195 suites completed, 0 aborted** (~2m24s). Full
  raw output captured and read by me (not summarized from the evaluator's claim) — includes the new
  `ClaudeProtocolSpec`/`HttpClaudeTransportSpec`/`ClaudeClientSpec`/`AssistantTelemetrySpec` cases
  passing.
- `npm run lint` → clean, zero output (zero-warnings policy, `eslint . --max-warnings=0`).
- `npm test` → **186 (helio-mcp) + 1875 (frontend) = 2061 tests, all passed**, 8 + 180 suites.
- `npm run check:schemas` → "schemas in sync with JsonProtocols (61 checked across 45 protocol
  files)"; "panel-type enums in sync (7 surfaces checked)".
- `npm run check:scala-quality` → exit 0, "clean (116 soft warning(s))" — all soft file-size budget
  notices, none touching a file this change modified beyond what evaluation-1.md already flagged as
  non-blocking (`ClaudeClient.scala` 262 lines, `ClaudeClientSpec.scala` 554 lines,
  `AssistantTelemetrySpec.scala` 270 lines — all pre-existing-over-budget or newly-but-modestly over,
  informational only per `CONTRIBUTING.md`).
- `npm run check:openspec` → "change 'assistant-prompt-caching' is complete (14/14) but not
  archived" — exactly the expected pre-archive state per the task brief, not a defect.
- `openspec validate assistant-prompt-caching --strict` → "Change 'assistant-prompt-caching' is
  valid".

All gate results match evaluation-1.md's claims exactly (same test counts, same "clean"/"in sync"
outcomes) — re-run independently, not copied.

### Frontend / UI surface

This change has **zero frontend surface** — confirmed via `git diff main...HEAD --name-only`, no
`frontend/**` files present. No dev-server startup or Playwright session was run, per the task
brief's explicit instruction for a change of this shape (matches the ticket's own scope note: "Pure
backend wire-protocol change — no schema/frontend/database impact, no migration").

### Verdict: CONFIRM

All three ACs trace to real, tested code. Every ADDED/MODIFIED spec-delta scenario maps to a real,
passing test I read in full — not taken on the evaluator's or either skeptic-design round's word.
The design-gate's D1–D6 decisions and skeptic-design-1's CR1 (fixture update + MODIFIED-requirement
supersession) are faithfully implemented with no silent deviation. Zero domain/semantic drift in the
diff; the only wire-shape differences are the two the design explicitly calls out and tests pin
(cache_control markers, marked-message string→block-array form). All gates re-run fresh by me this
review pass, green.

### Non-blocking notes

- `stream`/`DashboardAuthoringService`/`RefinementService`'s own `TokenUsage` accumulation
  (`DashboardAuthoringService.scala:336,373,427`, `RefinementService.scala:166`,
  `ClaudeSseFrameParser.scala:63`) does not forward the two new cache counters, even though those
  paths do send a cache-marked first message (via the shared `toApiRequest`) and, per design.md's own
  Risks section, do read the cache on repair round-trips. This is an explicit, twice-reviewed-and-
  accepted non-goal ("No `AuthoringTelemetry` extension for the `send` path"), not a ticket-AC
  violation — flagging only as a real, currently-unrealized observability gap a future ticket could
  close (the realized cache savings on the authoring/repair paths are invisible to telemetry today,
  same as before this change).
- `ClaudeClient.scala` (262 lines) is now past the 250-line soft budget; `check:scala-quality` treats
  this as informational only, and evaluation-1.md already flagged it as a non-blocking suggestion to
  extract the two marking helpers if the file grows further. I agree this isn't blocking.
