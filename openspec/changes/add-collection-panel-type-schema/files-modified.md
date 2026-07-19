# Files modified — HEL-310

- `schemas/update-panels-batch-request.schema.json` — added `collection` to the panels-batch item `type` enum (was missing; 7 → 8 values).
- `schemas/dashboard-proposal.schema.json` — added `collection` to `$defs.ProposalPanel.properties.type.enum`; updated the `dataTypeId` description to list `collection` alongside metric/chart/table as requiring a bound DataType.
- `helio-mcp/src/tools/proposal.ts` — widened `PANEL_TYPES` (full set) and `DATA_PANEL_TYPES` (data-panel set) to include `collection`, matching backend `PanelType`/`DataPanelKinds`.
- `frontend/src/features/dashboards/ui/ProposalReview.tsx` — widened `DATA_PANEL_TYPES` to include `collection`, restoring the "needs bound DataType" warning + DataType info row for collection panels in a proposal.
- `frontend/src/features/dashboards/ui/ProposalReview.test.tsx` — added a test asserting an unbound `collection` panel surfaces the "No DataType bound" warning.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added a route contract test creating a panel with `type: "collection"` via `POST /api/panels`, asserting `201 Created` and `type: "collection"` echoed in the response.
- `scripts/check-schema-drift.mjs` — added a panel-type-enum parity guard: parses the canonical panel-type set from `PanelType.fromString` (`backend/.../domain/model.scala`) and the canonical data-panel set from `DataPanelKinds` (`backend/.../services/DashboardProposalService.scala`), then asserts the four JSON Schema `type` enums (create-panel-request, panel, update-panels-batch-request, dashboard-proposal), helio-mcp `PANEL_TYPES`/`DATA_PANEL_TYPES`, and `ProposalReview.tsx`'s `DATA_PANEL_TYPES` each match exactly. Reports the diverging surface + expected vs. actual on mismatch. `helio-mcp/src/tools/write.ts` enums are explicitly out of scope (deliberate `divider` omission).
- `openspec/changes/add-collection-panel-type-schema/tasks.md` — checked off completed tasks.

## Confirmed correct, no change needed

- `schemas/create-panel-request.schema.json` — already included `collection` (fixed by HEL-315).
- `schemas/panel.schema.json` — already included `collection`.
- `backend/src/main/scala/com/helio/domain/model.scala` `PanelType` — canonical source, already has `collection`.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` `DataPanelKinds` — canonical data-panel source, already has `collection`.
- `frontend/src/features/panels/types/panel.ts` `PanelKind` union — already has `collection`.
- `helio-mcp/src/tools/write.ts` `create_panel`/`bind_panel` `type` enums — already has `collection`; intentionally omits `divider` (documented MCP-vs-app divergence), so it is out of the new parity-guard scope by design.

## Root cause / probe (bug: several panel-type enum surfaces omit `collection`)

- **Root cause:** `collection` became a real panel kind in HEL-247/PR#233 by extending the backend canonical sets (`PanelType.fromString`, `DataPanelKinds`), but the JSON Schema and TS enum surfaces that separately re-enumerate panel types (`update-panels-batch-request.schema.json`, `dashboard-proposal.schema.json`, helio-mcp `proposal.ts`, `ProposalReview.tsx`) were never updated in lockstep — there was no automated parity check between the backend canonical source and these surfaces, so the omission was invisible to CI.
- **Probe:** ran `npm run check:schemas` before adding `collection` to the two schemas — it passed (case-class field parity only), confirming the pre-existing checker did not catch enum-value drift. After adding the new panel-type-enum parity guard, re-ran the checker with `collection` temporarily removed from `schemas/panel.schema.json` (`sed -i 's/"divider", "collection"/"divider"/' schemas/panel.schema.json && npm run check:schemas`).
- **Probe output:**
  ```
  Schema/JsonProtocols drift detected:

  schemas/panel.schema.json properties.type.enum:
    missing: collection

  Update either the schema in schemas/ or the case class under backend/.../api/protocols/ so they agree.
  For panel-type enum mismatches, widen the diverging surface to match the backend canonical set (PanelType.fromString / DataPanelKinds).
  ```
  This confirms the new guard fails loudly (exit 1, names the file + missing value) on the exact drift class that caused HEL-310, and the file was restored immediately after the probe.
