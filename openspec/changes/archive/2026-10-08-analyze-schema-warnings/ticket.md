# HEL-1235: analyze_pipeline should warn on missing referenced field, join-key type mismatch, and output-column collision

## Description

Follow-up from HEL-1069.

origin_kind: followup
origin_ticket: HEL-1069

HEL-1069's probe showed `analyze_pipeline` (GET /api/pipelines/:id/analyze) returns 200 with no warning for three silent-wrong-result shapes:

* a step referencing a field absent from its inputSchema (e.g. `count(amount)` over a step that outputs `(category,total)` yields n=0);
* a join whose key types mismatch between lanes (CSV reads as strings; join output is 0 rows, run is clean);
* two lanes aliasing the same output column name into a join.

Ask: surface these as analyze warnings (schema-only checks), so an agent sees them before running. HEL-1069 itself only adds per-step row counts and zero-row warnings to the MCP run result.

## Acceptance Criteria (derived; ticket states the ask in prose)

1. `GET /api/pipelines/:id/analyze` and `POST /api/pipelines/analyze-proposal` return a non-blocking warning for each of the three shapes above, computed from schemas only (no row reads).
2. Warnings are NON-BLOCKING: they never set a step's `validationError`, never feed `costVerdict.canRun`/`autoRunnable`/`reasons`, never feed `PipelineAnalyzeService.stepConfigProblem` / the dataset-write auto-run gate (HEL-1279), and never cause write-time rejection.
3. Warning wording states the evidence base ("not found in the inferred input schema"), since a stored inferred schema can be stale (HEL-1280).
4. The wire contract ships with the code: `schemas/pipelines/*analyze*` JSON Schemas, helio-mcp types and `analyze_pipeline`/`analyze_pipeline_proposal` tool descriptions, and frontend analyze types.
5. A red-first test exists per warning class.

## Premise validation notes (Setup, 2026-10-08)

- Several ops already emit a BLOCKING `validationError` "Unknown field ..." (compute, convertformat, analyzewithai, generatetext, splittext, extractheadings, chunkbytokencount, pivot, unpivot, assert). The missing-field warning covers only references NOT already reported as an error.
- Since filing, HEL-1236/HEL-1250 made join/lookup column collisions non-destructive: the colliding right column is renamed `right_<name>` (owner ruling 2026-10-03: a collision never errors). The collision warning therefore reports the rename, it does not claim an overwrite.
- CSV sources infer every column as `string` (HEL-893), so a string-vs-numeric join key mismatch is visible in schema types.
