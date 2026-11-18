## Why

HEL-921 needs an `insight` Output kind before any render store (L2), trigger (L4) or UI (L5) can exist. Today the
Output kind set is a closed sealed trait enumerated by hand in ~20 places with no drift guard, so adding a kind silently
misses sites. L1 registers the kind, validates its config and pins every enumeration site, with no rendering and no
model call.

## What Changes

- New Output kind `insight` (backend enum, V141 widens the `outputs.kind` CHECK, JSON schemas, frontend types).
- Insight config, validated on every Output write path: `preset` (an L3 preset id, default `auto`), optional `prompt`,
  `reads: {outputs[], windows[]}` (sibling Outputs of the same pipeline, at most 8, never the insight itself; absent
  means "the other Outputs on the same node"), `refresh: on_run | daily | manual` (default `on_run`), `maxSentences`
  (default 2) and `maxChars` (bounded ceiling). Any other key is a 400 naming it. No fieldMapping slots.
- `insight` gets a panel default size and a vacuously-bindable binding spec (like `markdown`).
- The summary reducer stores null `metric`/`series` for `insight` (already true; pinned by a test).
- Placed on a dashboard (and in the live Output column), an insight shows a "not yet rendered" state.
- A drift test pins every Output-kind enumeration site. Surfaces owned by later leaves (MCP enums and the
  assistant proposal tool schema: L8; Output-editor kind picker: L5) are pinned as explicit exclusions.

## Capabilities

### New Capabilities

- `insight-output-kind`: the `insight` kind, its config contract and its not-yet-rendered panel state.

### Modified Capabilities

- `outputs-model`: the allowed Output kind set gains `insight`.

## Non-goals

- The `model` config key (L4, after HEL-1755), any render, render storage or read API (L2), triggers/quota (L4),
  authoring UI (L5), ask (L6/L7), MCP and proposal surfaces (L8). No model call, no `ClaudeClient` use.

## Impact

Backend domain/validation/packer/binding spec + V141; JSON schemas; frontend Output types, panel and live-column
render, editor exhaustiveness; drift tests. No change to HEL-1755's files (AssistantService, ClaudeConfig,
ChatAccessService, model catalog).
