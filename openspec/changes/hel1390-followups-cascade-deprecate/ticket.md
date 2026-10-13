# HEL-1440: After HEL-1390: inert panel-level fieldMapping/aggregation in proposal schema; e2e cleanup unchecked; pipeline_run_rate_window doesn't cascade on user delete; wrong chart slot names in test fixtures

## Description

Origin: HEL-1390 (matto00/helio#883), lane-reported.

1. `ProposalPanelSchema` and `schemas/dashboards/dashboard-proposal.schema.json` still accept panel-level
   `fieldMapping`/`aggregation`/`label`/`unit`, which are inert (they live on Output config). Remove them, or mark
   them ignored/deprecated. This is a wire-contract change, so check the MCP/assistant callers and the schema-drift
   check.
2. The e2e specs don't check the status of their cleanup deletes and leave throwaway users behind (hel1390, hel1304,
   hel1351). Overlaps HEL-1301.
3. `pipeline_run_rate_window.user_id` doesn't cascade on user delete; it blocked an exact-id user delete. Feed into
   HEL-1301 and HEL-1347's `docs/user-reference-inventory.md`.
4. Frontend test fixtures use `{category, value}` as chart mappings (`buildOutputConfig.test.ts:123-134`,
   `OutputEditorSheet.configPatch.test.tsx`). Use the real slots (xAxis/yAxis/series/annotation).
5. Nits: un-indented `.flatMap` body at `PipelineService.scala:694-708`; `asInstanceOf[JsString]` in the new backend
   test helper.

## Premise validation (orchestrator, 2026-10-13, against origin/main f63ab8365)

- Item 1: live. Chosen resolution: mark deprecated (the ticket's second option), not remove — removal would break
  `mcp-panel-composition-tools` "Proposal config passthrough is backward compatible" and reject old callers
  (`additionalProperties: false`). No wire-contract change, so no assumed product call.
- Item 2: the "users left behind" half is already fixed by HEL-1301 (5986340c5: recorded users deleted by exact id in
  global teardown). The unchecked cleanup-delete statuses are still live in all three specs.
- Item 3: live (V109 FK is NO ACTION). Migration number V133 (V131/V132 reserved by parked PRs #994/#1000).
- Item 4: live (line numbers moved).
- Item 5a: already fixed — the code moved to `PipelineCreatePreflight.validateOutputConfig` (HEL-1469, #918) and is
  formatted. Dropped. Item 5b: live (`AssistantProposalToolSchemasSpec.scala:263,324`).

## Acceptance Criteria

- AC1: Panel-level `fieldMapping`, `aggregation`, `label`, `unit` on `ProposalPanel` are marked deprecated/ignored on
  every agent-facing surface: `schemas/dashboards/dashboard-proposal.schema.json` (`"deprecated": true` + description),
  the assistant tool schema `ProposalPanelSchema` (`AssistantProposalToolSchemas.scala`), the MCP zod `panelSchema`
  (`helio-mcp/src/tools/proposal.ts`), and the frontend `ProposalPanel` type (JSDoc `@deprecated`). They are still
  accepted (a proposal carrying them is not rejected) and still have no effect. `npm run check:schemas` passes.
- AC2: `e2e/hel1390-*`, `e2e/hel1304-*`, `e2e/hel1351-*` check the status of each cleanup delete without masking a
  test-body failure.
- AC3: Migration `V133` makes `pipeline_run_rate_window.user_id` `ON DELETE CASCADE`; verified on
  VerifiedEmbeddedPostgres only (never the shared dev DB); `docs/user-reference-inventory.md` updated so
  `V119OwnerFkMigrationSpec` stays green; a test proves a user with a rate-window row (and nothing else blocking) is
  deleted and the row goes with it.
- AC4: Chart-kind fixtures in `buildOutputConfig.test.ts` and `OutputEditorSheet.configPatch.test.tsx` use real chart
  slots (`xAxis`/`yAxis`/`series`/`annotation`).
- AC5: `asInstanceOf[JsString]` in `AssistantProposalToolSchemasSpec.scala` replaced with a safe pattern match /
  `convertTo[String]`.
