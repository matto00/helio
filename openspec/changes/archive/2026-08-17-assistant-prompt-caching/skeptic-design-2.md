## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Read all five change-dir docs fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and prior
  `skeptic-design-1.md` — none taken on faith, all cross-checked against ground truth below.
- **Round-1 CR1(a) — explicit fixture-update task**: `tasks.md:27` (task 4.6) now reads: "Update
  `ClaudeClientSpec`'s 'wire model/max-tokens/temperature/messages through to the transport request' expected
  `ClaudeApiRequest` to carry the first-message cache marker — the suite's only full-request exact-equality
  fixture (spec: 'send's existing behavior is unchanged' MODIFIED scenario; skeptic-design-1.md CR1)." Present,
  specific, and correctly scoped. Confirmed.
- **Round-1 CR1(b) — MODIFIED-requirement entry in the delta**: read
  `openspec/changes/assistant-prompt-caching/specs/claude-api-client/spec.md:29-44`. It carries a `## MODIFIED
  Requirements` section for `Requirement: Existing single-shot send and stream are unaffected` that:
  - **Faithfully reproduces** the active spec's original requirement text verbatim
    (`openspec/specs/claude-api-client/spec.md:246-249`) before appending the superseding sentence ("Prompt-cache
    support supersedes the 'unmodified' guarantee in exactly one additive way...").
  - **Rewrites the scenario coherently**: "send's existing behavior is unchanged" no longer asserts "every existing
    test passes unmodified" (the now-false claim CR1 flagged) but "every test passes, with the sole permitted
    modification that expected built requests now carry the first-message cache marker — no other expectation
    changes." This is self-consistent with D3's unconditional first-message marking and with task 4.6.
  - Ran `openspec validate assistant-prompt-caching --strict` from the worktree root → `Change
    'assistant-prompt-caching' is valid`, confirming the delta is structurally well-formed (correct ADDED/MODIFIED
    headers, scenario formatting) and will merge cleanly on archive.
- **Verified CR1's underlying factual claim still holds against the actual test file** (not re-derived from the
  prior report): read `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` in full (456 lines). Line 84's
  `transport.lastRequest shouldBe Some(` followed immediately by `ClaudeApiRequest(...)` at lines 85-92 is the exact
  full-request-equality fixture CR1 identified — confirmed via `awk` extraction of the actual six lines, not just
  grep-pattern trust. Ran `grep -rn "shouldBe Some($" backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` →
  exactly one hit (line 84); ran the analogous check across the whole `com/helio/ai` test directory for any other
  `shouldBe Some(`/`shouldBe ClaudeApi*` exact-equality assertion → none found. This independently reconfirms CR1's
  narrower claim that only `send`'s fixture needs updating and `sendTool` fixtures (which assert on `.isError`/
  `.text` of `messages.last`, not full-request equality) are unaffected — so task 4.6 alone is sufficient scope for
  the test-fixture fix; no missing companion task for `sendTool`.
- **Re-verified ground-truth code the design describes as current state** (not re-derived from round-1's report):
  read `ClaudeWireModels.scala`, `ClaudeProtocol.scala`, `ClaudeClient.scala`, `ClaudeModels.scala`,
  `AssistantTelemetry.scala` in full. Confirmed still accurate: `ClaudeApiMessage(role: String, content: String)`
  with no cache field (`ClaudeWireModels.scala:11`); `claudeApiMessageFormat` is still `jsonFormat2` (
  `ClaudeProtocol.scala:12`); `ClaudeApiUsage(inputTokens, outputTokens)` has no cache counters (
  `ClaudeWireModels.scala:21`); `ClaudeClient.toApiToolRequest`/`toApiRequest`/`addUsage`/`toClaudeResponse` match
  the design's description line-for-line (`ClaudeClient.scala:161-223`); `TokenUsage(inputTokens, outputTokens)` has
  no cache fields (`ClaudeModels.scala:34`); `AssistantTelemetry.emitToolLoopOutcome` only carries
  `inputTokens`/`outputTokens` today (`AssistantTelemetry.scala:34-55`).
- **Cross-checked both spec deltas against the currently-active base specs**: `openspec/specs/claude-api-client/
  spec.md` and `openspec/specs/assistant-tool-loop-telemetry/spec.md` read in full. Both capabilities pre-exist and
  are correctly modeled as MODIFIED (not ADDED). The `assistant-tool-loop-telemetry` delta's MODIFIED requirement
  preserves all three of the base spec's existing scenarios and adds a fourth ("A multi-hop turn's record shows
  nonzero cache reads") without dropping or contradicting anything; the base spec's second requirement ("A failed
  converse call SHALL NOT emit a tool-loop-outcome record") is correctly left untouched since this change doesn't
  affect it.
- **AC traceability**: AC #1 (breakpoints on stable prefix, both paths) → ADDED requirement +
  D2/D3/tasks 1.1-1.3/2.1-2.2. AC #2 (nonzero `cache_read_input_tokens` on a multi-hop turn) → D4/D5/tasks 1.4/2.3/
  3.1, with D6 honestly scoping the live nonzero-observation half of the AC as post-deploy (CI proves the
  request/parse/aggregate/log chain via stubbed values) — this framing was already reviewed and accepted in round 1
  and is unchanged. AC #3 (zero behavior change) → `cache_control` is purely a billing/latency wire annotation the
  Anthropic API does not use to alter response content; D3's breakpoint placement doesn't touch message content or
  ordering that reaches the model as meaningfully different input.
- **No placeholders/TODOs**: `grep -rniE "TODO|TBD|figure out later|to be decided|placeholder"` across the change
  dir returns only a quoted mention inside `skeptic-design-1.md`'s own prose (not a real placeholder). Clean.
- **No scope drift**: `git status --porcelain` shows only the untracked `openspec/changes/assistant-prompt-caching/`
  directory — no code changed yet (consistent with design gate, implementation not started), and the design's
  Impact/Non-goals sections still bound the change to `com.helio.ai` + `AssistantTelemetry`, matching the ticket's
  stated scope with no expansion.

### Verdict: CONFIRM

Round-1 CR1's both required revisions are genuinely present, technically accurate, and internally coherent — not
just superficially added. The MODIFIED-requirement entry faithfully carries the superseded requirement's original
text before amending it, `openspec validate --strict` confirms it will archive cleanly, and I independently
re-derived (rather than trusted) that task 4.6 is the correct and complete scope for the test-fixture fix. The rest
of the design (D1-D6, tasks, both spec deltas) still checks out against current ground-truth code exactly as round 1
found, with no new inconsistencies introduced by this revision.

### Non-blocking notes

- Task 4.6 (the fixture update) is ordered after task 4.5 ("Run `sbt test`... confirm zero frontend/schema diffs"),
  which reads a little oddly sequentially (updating the now-broken fixture before the "run the suite" task would be
  the more natural order), but tasks.md is a checklist, not a strict execution script, and the executor will
  self-evidently need the fixture fixed before any `sbt test` run succeeds. Not a real defect — purely cosmetic
  ordering.
- `scripts/concertino/next-report-number.sh` (and presumably `persist-evidence.sh`/`emit-event.sh`) are absent from
  this worktree's `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
  `start-servers.sh`, `README.md` are present) — this worktree predates those scripts landing on `main`. I invoked
  the main checkout's copies (`/home/matt/Development/helio/scripts/concertino/...`) pointed at the worktree's
  change-dir path, which worked correctly, but flagging this drift in case it affects a later phase of this same
  ticket run that assumes those scripts exist inside the worktree.
