## Why

HEL-1235 (and HEL-1403) made `analyze` return schema-only, NON-BLOCKING `warnings`, but nobody sees them:
the pipeline editor ignores them, helio-mcp `get_workspace_context` drops them, `lookup` misses two cases
`join` already covers, and one tool description contradicts the concise payload. HEL-1414 closes those gaps.

## What Changes

- Pipeline editor: each step's analyze warnings render on its own StepCard in the owner-ruled placement
  (Planning escalation; mockups in `.concertino/runs/HEL-1414/evidence/mockups/`), with non-blocking copy.
- helio-mcp `get_workspace_context`: each pipeline step entry carries its warnings (full and concise mode);
  the tool description says so.
- Analyze: a `lookup` whose `sourceKey`/`lookupKey` type families differ warns `join-key-type-mismatch`.
- Analyze: a `lookup` with a `source`-kind secondary gets `join-column-renamed` warnings (today only a
  lane secondary does).
- `analyze_pipeline` description: concise mode no longer claims "no column lists" while warning messages
  may name up to 20 available columns.
- Doc leftovers: `PipelineAnalyzeSchemaWarningsSpec` header points at the real mutation record; the archived
  HEL-1235 `tasks.md` 1.3 `compute` rationale is corrected.

## Capabilities

### New Capabilities
- `pipeline-step-warning-display`: analyze warnings rendered on StepCards in the pipeline editor.

### Modified Capabilities
- `pipeline-analyze-schema-warnings`: lookup key type mismatch; lookup rename with a source secondary;
  workspace-context exposure; concise tool wording.

## Non-goals

- No change to which pipelines can run: warnings never feed validationError, costVerdict,
  stepConfigProblem, validateRawConfig or the HEL-1384 RunConfigGate.
- No change to lookup's projected output schema for a source secondary (analyzeNodes stays join-only).
- No fix to HEL-1437's "can't run" wording on the step-config-invalid notice.
- No new warning codes; no warnings on the create-pipeline modal / proposal review surface.

## Impact

- Backend: `AnalyzeSchemaWarnings.scala`, `PipelineService.scala` (secondary source loading), tests.
- Frontend: `StepCard.tsx` and its prop chain (`PipelineRiverView`, `LaneColumn`, `RootColumn`), CSS, tests.
- helio-mcp: `context.ts`, `tools/read.ts`, types, tests. Schemas unchanged (codes unchanged).
