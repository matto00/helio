## Context

`AssistantToolExecutor` (`backend/src/main/scala/com/helio/services/AssistantToolExecutor.scala`)
dispatches the 6-tool set `AssistantProtocol.assistantTools` for `AssistantService.converse`'s
bounded tool loop (`maxHops = 3`). `propose_pipeline`/`propose_combined` decode into
`PipelineProposal`, whose `source: PipelineProposalSource` already carries typed
`restConfig: Option[RestApiConfigPayload]` / `sqlConfig: Option[SqlSourceConfigPayload]` fields
(populated only on the inline branch — mutually exclusive with `sourceId`). A complete
`Connector[Config].testConnection` capability already exists and is wired only to
`SourceService.testSql`/`testRest` (`POST /api/sources/test`), never called from the assistant.

## Goals / Non-Goals

**Goals:**
- Give the assistant a `test_connection` tool backed by the existing `SourceService.testSql`/`testRest`.
- Structurally require (not just prompt-suggest) a successful `test_connection` call against the exact
  inline `rest_api`/`sql` config before a `propose_pipeline`/`propose_combined` call carrying that
  config is allowed to finalize.

**Non-Goals:**
- Judging whether a *reachable* endpoint is the *right* one (sibling ticket).
- Verifying `sourceId`-referenced (existing) sources — already validated at creation time.
- Verifying `csv`/`static` inline sources — no live endpoint to reach.

## Decisions

**D1 — Verification is enforced in `AssistantToolExecutor`, not the system prompt alone.** The ticket
asks for "system prompt/tool-loop logic [to] require" the call — mirrors this class's existing Hard
Boundary style (no apply-shaped tool exists structurally; a validation failure is fed back as a tool
error, not silently accepted). A prompt-only nudge is exactly the class of gap this ticket exists to
close (the live ESPN example: the assistant never even considered checking). Implementation: a new
thread-safe `verifiedConfigs: AtomicReference[Set[VerifiedConfig]]` field (same pattern as
`capturedProposal` — `sendWithTools` executes same-hop `tool_use` blocks concurrently via
`Future.traverse`), where `VerifiedConfig` is a closed ADT over the two typed config case classes
(`RestApiConfigPayload`/`SqlSourceConfigPayload`) rather than a JSON string fingerprint — reuses their
existing `equals`, no canonicalization risk. Populated only on `executeTestConnection`'s `ok = true`
(mirrors `capturedProposal`'s "only set on success" rule) — a failed test never marks a config
verified, and a stale success from a config Claude later edited does not carry over (the changed
config simply isn't a member of the set).

**D2 — Same-hop race is resolved conservatively.** If Claude calls `test_connection` and
`propose_pipeline` for the same config in the *same* hop, `Future.traverse`'s execution order is
unspecified — the propose call may run before the test's result lands in `verifiedConfigs`. This can
only ever cause an over-cautious rejection (config not yet in the set when checked), never a false
verification bypass, so it's safe by construction; it costs Claude one extra hop, not a correctness
gap. `AssistantSystemPrompt` explicitly instructs calling `test_connection` in its own hop, before
`propose_pipeline`/`propose_combined`, to avoid hitting this in practice.

**D3 — `MaxHops` rises from 3 to 4.** The dominant new flow — `find` → `test_connection` →
`propose_pipeline` — already fills the entire existing 3-hop budget with zero room for a `get_resource`
call or a retry after a failed test. Bumping the cap is a single-line, caller-supplied change
(`AssistantService.MaxHops`, already documented as "never hardcoded inside `ClaudeClient`") — no
`ClaudeClient`/`ClaudeToolRequest` change needed. Accepted as in-scope: without it, this fix would
regress `HopBudgetExhausted` frequency for the assistant's most common data-creation path.

**D4 — `propose_combined` checks the nested `pipeline.source` the same way.** `CombinedProposal.pipeline`
is a `PipelineProposal` with the identical `source` shape — one shared private helper
(`requireVerifiedInlineSource`) is called from both `executeProposePipeline` and
`executeProposeCombined`, never duplicated.

**D5 — `test_connection`'s tool input reuses the existing discriminated `type`/`config` shape.**
Matches `PipelineProposalSourceSchema`'s inline-source shape and `SourcePreviewRoutes`'s `POST
/api/sources/test` dispatch convention (`type` selects `RestApiConfigPayload` vs. `SqlInferRequest`'s
`SqlSourceConfigPayload`) — no new wire shape invented.

## Risks / Trade-offs

- [Risk] A rejected `propose_pipeline` call (untested config) costs Claude a hop it wasn't counting
  on → Mitigated by D3's hop-budget increase and an explicit system-prompt ordering instruction (D2).
- [Risk] `verifiedConfigs` grows unbounded within one `AssistantToolExecutor` instance → Not a real
  concern: the instance is constructed fresh per `converse` call and discarded after (existing
  `capturedProposal` doc comment), so its lifetime is one turn, at most a handful of entries.
- [Trade-off] Verification is by exact config equality, not fuzzy/semantic match → Deliberate (D1):
  a config Claude edits after testing (even trivially, e.g. adding a header) must be re-tested, since
  the edit could be exactly what breaks reachability.

## Planner Notes

Self-approved: enforcing this structurally (D1) rather than via prompt text alone, and raising
`MaxHops` to 4 (D3) — both directly implement what the ticket's "Fix" section already asks for
("system prompt/tool-loop logic require calling it"); neither is a new external dependency, breaking
API change, or scope beyond the ticket.
