# Add `collection` to panel-type contract surfaces

## Why

`collection` became a real panel kind in HEL-247 and the backend accepts it everywhere (create, PATCH,
proposal-apply — `DataPanelKinds` has included it since PR #233), but several contract surfaces that
enumerate panel types were never widened. The schemas are the source of truth for the API contract and
the agent-native layer builds on them — an agent following the contract cannot propose or batch-update
collection panels.

## What Changes

Audit result — every location that enumerates panel types:

| Location | State on main | Action |
| --- | --- | --- |
| `schemas/create-panel-request.schema.json` `type` enum | has `collection` (fixed by HEL-315) | confirm + cover with check |
| `schemas/panel.schema.json` `type` enum | has `collection` | confirm + cover with check |
| `schemas/update-panels-batch-request.schema.json` items `type` enum | **missing** | add `collection` |
| `schemas/dashboard-proposal.schema.json` panels `type` enum | **missing** | add `collection` (+ note `dataTypeId` is required for it — backend `DataPanelKinds` already treats it as a data panel) |
| `helio-mcp/src/tools/proposal.ts` `PANEL_TYPES` / `DATA_PANEL_TYPES` zod enums | **missing** | add `collection` to both |
| `frontend .../dashboards/ui/ProposalReview.tsx:29` `DATA_PANEL_TYPES` (used at 60/146, drives the "needs bound DataType" warning + info row) | **missing** | add `collection` — else a collection panel in a proposal (which this change now legalizes) renders with no binding warning |
| `backend .../domain/model.scala` `PanelType` parser | has `collection` | confirm (canonical source) |
| `backend .../services/DashboardProposalService.scala` `DataPanelKinds` | has `collection` | confirm (canonical data-panel source) |
| `frontend .../panels/types/panel.ts` `PanelKind` union | has `collection` | confirm |
| `helio-mcp/src/tools/write.ts:253,283` `create_panel`/`bind_panel` `type` enums | has `collection`; **intentionally omit `divider`** (documented MCP-vs-app divergence) | confirm — out of parity-guard scope (deliberate scoped subset, not the canonical set) |
| OpenAPI specs | none exist in the repo (`openspec/` is change management, not OpenAPI) | confirm n/a |

- Add a **panel-type-enum parity check** to `scripts/check-schema-drift.mjs` (`npm run check:schemas`):
  parse the canonical panel-type set from the backend `PanelType` parser and the canonical data-panel
  set from `DataPanelKinds`, then assert every enumerating surface matches exactly — the four JSON
  schema `type` enums, helio-mcp `proposal.ts` `PANEL_TYPES` (full set) / `DATA_PANEL_TYPES` (data-panel
  set), and `ProposalReview.tsx` `DATA_PANEL_TYPES` (data-panel set). This drift class then fails CI
  instead of recurring silently. `helio-mcp/src/tools/write.ts` enums are deliberately scoped subsets
  (omit `divider` by design) and are explicitly out of guard scope.
- Add a backend route-level contract test creating a panel with `type: "collection"` via
  `POST /api/panels` if none exists (satisfies the "contract test covering collection panel creation" AC).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `collection-panel-type`: add a requirement that every contract surface enumerating panel types
  (JSON Schemas, helio-mcp proposal tool) includes `collection`, guarded by the schema drift check.

## Non-goals

- No new proposal-path features for collection panels (itemOptions seeding, layout polish) — only enum
  parity with what the backend already supports.
- No new dependencies (no ajv); the guard extends the existing zero-dep drift checker.
- No backend or frontend behavior changes — backend/frontend already support `collection` everywhere.

## Impact

- `schemas/update-panels-batch-request.schema.json`, `schemas/dashboard-proposal.schema.json` (enum widened — additive, non-breaking)
- `helio-mcp/src/tools/proposal.ts` (zod enums widened — additive)
- `frontend/src/features/dashboards/ui/ProposalReview.tsx` (`DATA_PANEL_TYPES` widened — restores the missing binding warning + info row for collection panels in the Proposal Review UI)
- `scripts/check-schema-drift.mjs` (new parity assertion)
- `backend/src/test/...` (new/confirmed contract test)
- `openspec/specs/collection-panel-type/spec.md` (delta)
