## 1. Schema enum parity

- [x] 1.1 Add `collection` to the `type` enum in `schemas/update-panels-batch-request.schema.json`
- [x] 1.2 Add `collection` to the panels `type` enum in `schemas/dashboard-proposal.schema.json`
- [x] 1.3 Confirm `create-panel-request.schema.json` and `panel.schema.json` already include `collection`

## 2. TS enum parity

- [x] 2.1 Add `collection` to `PANEL_TYPES` in `helio-mcp/src/tools/proposal.ts`
- [x] 2.2 Add `collection` to `DATA_PANEL_TYPES` in `helio-mcp/src/tools/proposal.ts` (matches backend `DataPanelKinds`)
- [x] 2.3 Add `collection` to `DATA_PANEL_TYPES` in `frontend/src/features/dashboards/ui/ProposalReview.tsx` (restores the binding warning + info row for collection panels)

## 3. Parity guard in the drift checker

- [x] 3.1 In `scripts/check-schema-drift.mjs`, parse the canonical panel-type set from `PanelType.fromString` in `backend/.../domain/model.scala` (assert ≥ 8 types)
- [x] 3.2 Parse `DataPanelKinds` from `DashboardProposalService.scala` as the canonical data-panel set
- [x] 3.3 Assert each schema `type` enum (create-panel-request, panel, update-panels-batch-request, dashboard-proposal) equals the canonical set; report file + pointer on mismatch
- [x] 3.4 Assert helio-mcp `PANEL_TYPES` equals the canonical set; `DATA_PANEL_TYPES` (proposal.ts) and `ProposalReview.tsx` `DATA_PANEL_TYPES` each equal the canonical data-panel set (write.ts enums explicitly out of scope — deliberate `divider` omission)
- [x] 3.5 Run `npm run check:schemas` and confirm it passes

## 4. Tests

- [x] 4.1 Add/confirm a backend route contract test creating a panel with `type: "collection"` via `POST /api/panels`, asserting 2xx and `type: "collection"` echoed
- [x] 4.2 Add/confirm a frontend test asserting `ProposalReview` surfaces a binding warning for an unbound `collection` panel
- [x] 4.3 Run `npm run lint`, `npm test`, and `sbt test` (backend) — confirm green
- [x] 4.4 Build helio-mcp (`npm run build` in `helio-mcp/`) to confirm the zod enum change compiles
