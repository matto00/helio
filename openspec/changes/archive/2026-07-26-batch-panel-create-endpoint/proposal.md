## Why

`helio-news` builds a board with dozens of sequential `create_panel` calls (image + markdown per
story, plus day-in-review panels) — no collapse path exists for the non-data-panel fan-out. Helio
already has a batch **update** endpoint (`POST /api/panels/updateBatch`) but no batch **create**.

## What Changes

- New `POST /api/panels/batch` — creates N panels on one dashboard in a single Postgres transaction,
  all-or-nothing, returning created panels (with ids) in input order.
- Reuses `PanelService.buildForCreate` per item (the same construct-and-validate primitive HEL-363's
  replace-contents path uses) — no second, independently-written multi-panel validator. A new
  `PanelService.buildAllForCreate` sequential-build-with-short-circuit helper is extracted and
  `DashboardContentsService.buildPanels` is refactored (behavior-preserving) to call it too, so there
  is exactly one "validate every item before any write" implementation for panel batches, not two.
- New repository op `PanelMutationOps.insertBatch` — a single `.transactionally` multi-row INSERT
  (append-only; never deletes existing panels, unlike `DashboardContentsOps.replaceContents`, whose
  delete-then-insert semantics are for full replace, not incremental add).
- Batch items accept `config.dataTypeId` bound to a pre-existing pipeline-output DataType (same V41
  rule `buildForCreate` already enforces) — they do **not** build a source/pipeline/run chain
  (that's HEL-364's compound op, which explicitly excludes batch as a non-goal).
- New MCP `create_panels` tool (`helio-mcp/src/tools/write.ts` + `helioApi.ts`).
- New `schemas/create-panels-batch-request.schema.json` / `create-panels-batch-response.schema.json`.

## Capabilities

### New Capabilities
- `panel-batch-create`: `POST /api/panels/batch` — atomic, owner-scoped, all-or-nothing multi-panel
  create on one dashboard.

### Modified Capabilities
- `mcp-panel-composition-tools`: adds the `create_panels` tool wrapping the new endpoint.

## Impact

Backend: `PanelProtocol.scala` (new request/response types), `PanelService.scala` (`buildAllForCreate`,
`batchCreate`), `PanelServiceHelpers`/`ProposalPanelSupport`/`DashboardContentsService` (refactor to
share the new helper), `PanelMutationRepository.scala` (`insertBatch`), `PanelRoutes.scala` (new
`POST /api/panels/batch` route). MCP: `write.ts`, `helioApi.ts`. Schemas + `panel-batch-create` spec.
Additive only — `POST /api/panels`, `POST /api/panels/updateBatch`, and `PUT /api/dashboards/:id/contents`
are unchanged.

## Non-goals

Layout placement (HEL-367), resource tagging (HEL-366), panel-id reconciliation (HEL-368), external-run
hooks (HEL-369), pie/scatter aggregation (HEL-624), the source→pipeline→run→bind chain (HEL-364),
batching across multiple dashboards in one call.
