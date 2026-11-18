## Why

Insight Outputs (HEL-921) narrate one Output. Users also want to ask a free question of a whole board ("why did
revenue dip on the 14th?") and get a grounded, cited answer. L3 (HEL-1741) shipped the citation pack and validator;
this leaf (L6, HEL-1745) puts an ask loop on top of it, with read-only, scope-checked tools.

## What Changes

- New `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask` (authenticated tree only). Body
  `{question}`; response `{answer, citations, citedOutputs, pin}`. No model, token or cost field is ever
  returned. Answers are not persisted.
- New `AskDataService` (`services/ask/*`) running `ClaudeClient.sendWithTools` with `maxHops = 4`,
  `webSearch = false`, a fixed system prompt, and only read-only tools: `list_board_outputs`,
  `get_output_rows`, `get_output_history`, and `get_history_rows` (offered only when the caller holds a pipeline
  grant on an in-scope Output). Every tool call re-checks scope; a model-supplied id is never trusted.
- Tool results carry L3 citation cells; the final answer must pass `InsightValidator` against every citation the
  loop issued (one corrective retry, then a `422`).
- Every ask uses the server `CLAUDE_MODEL` (epic D1), with the `ClaudeModelCatalog` request rules. The asker pays
  through `ChatAccessService` at that model's weight; free tier gets `403 TIER_FORBIDDEN`.
- Public and share-token viewers are denied; only the owner or a grantee of the dashboard (or Output's pipeline).
- Pin: the response's `pin` block names the pipeline, node and `reads` for a `POST /api/pipelines/:id/outputs`
  insight create (`refresh: manual`, the question as `prompt`). Pin does NOT render: the render service is L4
  (HEL-1743, parked); the Output shows "Not yet rendered" until L4 wires render-on-pin.
- JSON schemas for the ask request and response under `schemas/ask/`.

## Capabilities

### New Capabilities
- `ask-your-data`: the ask routes, their access and billing rules, the read-only scoped tool set, citation
  validation of answers, and the pin hand-off.

### Modified Capabilities
- `insight-grounding`: the pack builder gains a citation-id offset so several packs in one ask loop never reuse an id.

## Non-goals

- Rendering an insight on pin (L4), any UI (L7), MCP tools (L8), web search, write or propose tools.
- Persisting questions or answers; streaming responses; a per-ask model choice (unruled; open owner question).
- Live calls on Sonnet or Opus (fakes only); a Flyway migration.

## Impact

Backend: new `services/ask/*`, `api/routes/ask/*`, wiring in `ApiRoutes.scala`, a small additive change to
`InsightContextBuilder.pack`. Schemas: `schemas/ask/*`. Docs: `CLAUDE.md` key-endpoints list. No frontend change.
