## schemas/ regrouping (76 files moved via `git mv` into domain subdirectories per design.md D1)

- `schemas/alerts/*.schema.json` (5), `schemas/auth/*.schema.json` (8), `schemas/dashboards/*.schema.json` (8), `schemas/panels/*.schema.json` (14), `schemas/pipelines/*.schema.json` (9), `schemas/hooks/*.schema.json` (2), `schemas/workspace/*.schema.json` (3), `schemas/shared/*.schema.json` (2), `schemas/metrics/*.schema.json` (4), `schemas/assistant/*.schema.json` (6), `schemas/authoring/*.schema.json` (7), `schemas/patch-sets/*.schema.json` (4), `schemas/agent-memory/*.schema.json` (3), `schemas/data-types/*.schema.json` (1) — relocated via `git mv`; `$ref`/`$id` values rewritten structure-aware (JSON.parse + tree walk, no regex) per design.md D4.

## Tooling

- `scripts/check-schema-drift.mjs` — recursive `readdirSync` (D2), 4 hardcoded panel-type-enum-parity paths updated to new nested locations (D3), added raw pre-filter file-count log line.

## Backend call sites (design.md D5/D6)

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — `JsonSchemaValidation.compile` call site + comment path.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — same.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — same.
- `backend/src/test/scala/com/helio/domain/panels/PanelBindingSpecSpec.scala` — comment path reference.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — comment path references.
- `backend/src/main/scala/com/helio/api/protocols/patchsets/PatchSetProtocol.scala` — comment path references.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala` — comment path references.
- `backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala` — comment path references.
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` — comment path references.
- `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala` — comment path reference.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — comment path reference.
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala` — comment path reference.
- `backend/build.sbt` — comment path reference.

## Frontend source-comment references (D6 sweep)

- `frontend/src/features/dashboards/types/proposal.ts`, `frontend/src/features/panels/types/panel.ts`, `frontend/src/features/patchSets/types/patchSet.ts`, `frontend/src/features/pipelines/types/pipelineSchedule.ts`, `frontend/src/features/settings/types/agentMemory.ts`, `frontend/src/features/settings/types/preferences.ts` — comment path references updated to new domain-prefixed paths.

## helio-mcp / docs

- `helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/types.ts` — comment path references.
- `docs/agent-native.md` — path reference.

## openspec/specs (D6 — 11 live spec.md files)

- `openspec/specs/chart-type-display-config/spec.md`, `openspec/specs/mcp-panel-composition-tools/spec.md`, `openspec/specs/panel-creation-type-config/spec.md`, `openspec/specs/patch-set-contract/spec.md`, `openspec/specs/panel-viz-aggregation/spec.md`, `openspec/specs/pipeline-analyze-api/spec.md` (incl. embedded OpenAPI `$ref`), `openspec/specs/pipeline-proposal-contract/spec.md`, `openspec/specs/timeline-panel-type/spec.md`, `openspec/specs/table-panel-display-config/spec.md`, `openspec/specs/workspace-context-assembly/spec.md`, `openspec/specs/collection-panel-type/spec.md` (bare-filename special case, domain prefix added per D6 round-3 CR2).

## Repo-root tidy

- `orchestration-flow.html` → `notes/orchestration-flow.html` (`git mv`); `development-plan.md` not moved (untracked/absent, per design.md D7).
