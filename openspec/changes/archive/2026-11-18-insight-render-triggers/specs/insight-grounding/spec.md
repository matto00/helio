## MODIFIED Requirements

### Requirement: Model call shape

A render SHALL call the model through a replaceable seam with a system prompt, no tools, no web search and at most 4096
output tokens, using the insight Output's `model` when set and otherwise the server's configured `CLAUDE_MODEL`. A
request for a `ClaudeModelCatalog` model SHALL carry no `temperature`, `top_p`, `top_k`, `thinking` budget or forced
`tool_choice`. Tests SHALL use a fake seam; only the owner-approved live check makes a live API call.

#### Scenario: Wire request carries system, no tools

- **WHEN** the production adapter renders over a recording fake transport
- **THEN** the recorded request has a non-empty system field, no tools, no web search tool and max tokens of at most 4096

#### Scenario: Per-Output model and catalog request rules

- **WHEN** the production adapter renders for an Output whose `model` is each catalog model in turn, and for one with no
  `model`, over a recording fake transport
- **THEN** each recorded request names that model (or the server default when absent) and none carries `temperature`,
  `top_p`, `top_k`, a thinking budget or a forced `tool_choice`
