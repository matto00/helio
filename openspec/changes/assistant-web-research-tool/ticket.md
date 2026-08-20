# HEL-757: Assistant has no way to research real, current API documentation — proposals are ungrounded LLM guesses

## Description

Confirmed via code: the server-side Claude client (`backend/src/main/scala/com/helio/ai/ClaudeClient.scala:172`) constructs only custom function-tools from `request.tools` — no Anthropic server-side tool type (e.g. a web-search tool) is ever attached to a request. `grep -rn "WebSearch|web_search|server_tool"` across the whole backend returns nothing. The assistant's own tool list (`AssistantToolExecutor.scala:80-85`) has no research capability at all — `find`/`get_resource` only search the user's own existing Helio workspace, nothing external.

This is a real product-trust gap, not just a rough edge: when a user asks the assistant to build a pipeline against some external API (e.g. "pull data from ESPN," "connect to the GitHub API"), the assistant has no way to look up whether that API actually exists, what its real base URL/auth/schema is, or whether it's been deprecated/renamed — it can only pattern-match against whatever it already happens to know from training, which can be stale, wrong, or entirely fabricated. The live incident that surfaced this (2026-08-19): the assistant proposed a REST source at a hostname that has never existed in DNS.

## Scope

Give the assistant genuine external research capability before it proposes a REST-based pipeline source, so its proposals are grounded in real, current information rather than an ungrounded guess. Concretely, this likely means wiring Anthropic's server-side web-search tool (or an equivalent) into the assistant's tool loop for the specific case of authoring a new REST data source — needs its own design pass to cover: which conversations get this capability (all, or only when authoring a REST source), cost/latency implications of an extra research round-trip per proposal, and whether results need any freshness/safety filtering before being trusted.

Complements the sibling ticket HEL-756 (already shipped, merged) — that ticket verifies a source *after* the assistant has picked a URL, via the existing connection-test capability, catching "I picked a plausible-looking URL that happens to be wrong." HEL-757 addresses the different problem "I don't actually know what the right URL is in the first place." Both gaps are real and distinct.

## Known open design questions (from ticket + orchestrator briefing)

- Which conversations/tool calls get research capability: all assistant turns, or only source-proposal turns (e.g. `propose_pipeline`/`propose_combined` when authoring a new REST source)?
- Cost/latency tradeoffs of an added web-research hop per proposal.
- Freshness/safety filtering of fetched content before it's trusted as grounding.
- Mechanism choice: Anthropic's server-side `web_search` tool (`ClaudeClient.scala` currently only ever constructs custom function-tools, never attaches an Anthropic server-side tool) vs. some other mechanism (e.g. a custom function-tool backed by a search API).

## Additional scope (fold-in, Delivery-phase triage)

`ClaudeClientSpec.scala`'s cross-hop web_search-budget-exhaustion test SHALL also assert that hop 1
(not just hop 0 and hop 2) omits the `WebSearch` tool once the cumulative budget is already
exhausted, tightening the existing test's precision. Triaged `fold-in` during Delivery (high file
overlap — this ticket already heavily modified this exact file) after evaluator/skeptic review;
human-approved. (Two sibling suggestions — a repository round-trip test, and a structural split of
this same spec file — were triaged `standalone` instead and filed as HEL-761/HEL-762.)

## Related

- Sibling ticket: HEL-756 (shipped) — connection-test verification wired into `propose_pipeline`/`propose_combined`.
- Follow-ups filed during Delivery: HEL-761 (repository round-trip test coverage), HEL-762
  (`ClaudeClientSpec.scala` structural split).
