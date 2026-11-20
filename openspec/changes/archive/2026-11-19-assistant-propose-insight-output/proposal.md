## Why

The in-app assistant cannot propose an `insight` Output: its proposal tool schema lists six kinds and
`OutputConfigValidation.KeysDoc` hides the insight config. helio-mcp gained the kind in HEL-1747; the assistant was a
recorded non-goal. Users asking the assistant for "a sentence summarising revenue" get nothing it can apply.

## What Changes

- The `propose_pipeline`/`propose_combined` Output `kind` enum is derived from `OutputKind.all`, so it carries
  `insight` and cannot drift again.
- `OutputConfigValidation.KeysDoc` documents every kind including `insight` (keys, allowed values, ranges, defaults,
  built from `InsightConfig`/`InsightPreset`/`InsightRefresh` constants). It says insight takes no `compare` or
  `historyPayloads`.
- Each assistant write path states its `reads.outputs` rule: on `propose_pipeline`/`propose_combined` (a new
  pipeline) a non-empty `reads.outputs` is rejected; on a `propose_patch_set` output create/update (an existing
  pipeline) it names stored ids of other non-insight Outputs of that pipeline.
- A patch-set insight output create is judged at preview exactly as at apply (reads check included).
- Creating an insight through any proposal never renders it; it renders on its next trigger.
- The assistant system prompt names the insight kind and when to use it.
- `OutputKindDriftSpec`'s assistant exclusions become positive checks.

## Capabilities

### New Capabilities
- `assistant-insight-proposals`: the in-app assistant proposes `insight` Outputs through its proposal tools.

### Modified Capabilities
(none)

## Non-goals

- No frontend change unless the proposal review UI fails to show an insight Output (verified, not assumed).
- No new assistant tool to render, refresh or read an insight.
- No `$ref` to an Output created in the same patch set inside `reads.outputs`.
- No migration.

## Impact

Backend only: `AssistantProposalToolSchemas.scala`, `OutputConfigValidation.scala`, `AssistantSystemPrompt.scala`,
patch-set output resolver, `OutputKindDriftSpec.scala` and new/extended specs. No API contract change (the routes
already accept `insight`).
