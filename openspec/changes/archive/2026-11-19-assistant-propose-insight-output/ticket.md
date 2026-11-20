# HEL-1779: In-app assistant cannot propose an insight Output

## Description

HEL-1747 added the `insight` Output kind to every helio-mcp tool, so an outside agent can create one. The in-app
workspace assistant still cannot: its proposal tool schemas (`AssistantProposalToolSchemas`) list no `insight` kind,
and `OutputConfigValidation.KeysDoc` does not describe the insight config to it. `OutputKindDriftSpec` now records
this gap as deliberate, so nothing will fail if it stays.

**Expected:** the assistant can propose an insight Output on an existing pipeline, with a valid config (preset,
optional prompt, reads, refresh), the same way it proposes other kinds.

## Acceptance Criteria

- A test that fails first: an assistant proposal with an `insight` Output validates and applies.
- The kind list and config docs come from the same source as the backend schema, and `OutputKindDriftSpec` checks the
  assistant surface positively instead of excluding it.
- Creating the insight through a proposal does not render it (the same rule as `add_output`).
- No live model call in tests; use the fake transport.

## Agent notes

- HEL-1747 evidence: `.concertino/runs/HEL-1747/evidence/` in the main checkout. Its archived change:
  `openspec/changes/archive/2026-11-18-insight-mcp-surface/`.
- Write-path difference HEL-1747's design gate found: on `create_pipeline` and the proposal tools, a non-empty
  `reads.outputs` is a 400 (`PipelineCreatePreflight`); on `add_output` it takes stored Output ids. The assistant docs
  must say which applies.
- Labels: Follow-up, Feature. Origin: HEL-1747.
