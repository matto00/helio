## Why

On prod (claude-haiku-4-5) "add more charts to my Standings dashboard" took ~43 tool calls, ~27 failed, and no proposal
would have applied. The causes are ours, not the model's: `get_resource(pipeline)` always returns an empty `laneTree` and
no step configs, the tool schemas are loose (no step-type enum, no per-step config shape, `lookup {}` accepted), errors
don't name the fix, `find` matches the whole query as one substring, and no tool can add an Output to an existing
pipeline, so the correct plan was not expressible.

## What Changes

- `get_resource(pipeline)` returns ordered steps with ids, configs, parent/lane and each node's output schema
  (name + type, from the symbolic analyze), plus the pipeline's Outputs with their node and kind.
- Assistant tool schemas: a step-type enum, per-step config schemas for the common ops, the compute expression grammar
  with examples, `additionalProperties: false` on the shapes the model got wrong, and an explicit panel-create shape.
- Propose-time validation: an Output id used as a root says "this is an Output, not a data source; extend its
  pipeline"; an unknown step type lists the valid ones; a step whose required config is missing (e.g. `lookup {}`)
  is rejected at propose time with the missing keys named.
- Patch sets gain `output` create (add an Output at an existing step of an existing pipeline) and an intra-set
  reference so a panel create in the same set can bind to that new Output.
- Only one `propose_*` call per model response is evaluated; extra ones get a clear error.
- `find` matches by tokens (every query word, or any, ranked) instead of one contiguous substring.
- System prompt: a tight model of source → steps → node schemas → Output (kind + fieldMapping) → panel, a decision
  procedure (inspect, extend the pipeline, put every Output and panel in ONE proposal), and a worked example.
- A replay eval harness and a measured before/after on a small eval set.

## Capabilities

### New Capabilities
- `assistant-pipeline-authoring-eval`: the replay eval set, fixture workspace and how failed-call rate is measured.

### Modified Capabilities
- `workspace-resource-search`: token-based `find` matching; pipeline `get_resource` detail.
- `patch-set-contract`: `output` create and intra-set Output references.
- `patch-set-apply`: applying and undoing an `output` create.
- `assistant-conversation-loop`: one propose per response; strict tool schemas; propose-time errors.

## Non-goals

- Dry-running apply-time checks before presenting (HEL-1638); Haiku 5.5 thinking blocks (HEL-1636);
  failure-based hop budget (HEL-1637); streaming (HEL-721).
- Taxonomy item 10 (overclaiming) beyond a prompt line; item 8 belongs to HEL-1638.

## Impact

Backend: `services/assistant/*`, `api/protocols/assistant/AssistantProposalToolSchemas.scala`,
`services/workspace/WorkspaceSearchService.scala`/`WorkspaceContextService.scala`, `services/patchsets/*`,
`services/pipelines/PipelineProposalService.scala`. Schemas: `schemas/` patch-set contract. Frontend: patch-set types
and preview rendering for an `output` create. helio-mcp patch-set tools inherit the new op.
