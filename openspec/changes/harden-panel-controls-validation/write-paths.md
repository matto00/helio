# Controls write paths (HEL-1203, design D4)

Enumerated from code (`grep controls|OutputPanelConfig|PanelConfigCodec|decodeCreateConfig`). Defect columns show the
state ON MAIN, measured by `PanelControlsValidationSpec` (45 cases, 15 passed / 30 failed on main; all 45 green after
the fix). D1 = malformed (non-array / non-object element / missing id), D2 = duplicate ids, D3 = controls on non-output.
Entry points reach panels only through these paths; each path's "fixed at" is the shared seam.

| Path | Entry point | file:line (main) | D1 malformed | D2 duplicate | D3 non-output | Fixed at |
|---|---|---|---|---|---|---|
| PATCH panel | `PanelService.update` -> `effectiveOutputConfig` / `PanelPatchApplier.applyConfig` | PanelService.scala:597,682 | RED: 500 x3 (uncaught `DeserializationException`) | RED: 200, persisted | RED: 200, silently ignored | `PanelConfigCodec.applyConfigPatch` (checks) + `update` maps its Left to 400 before any repo call |
| Batch PATCH (`/panels/updateBatch`) | `PanelService.batchUpdate` -> `PanelMutationRepository.batchUpdate` | PanelMutationRepository.scala:105 | already 400 but generic "Batch update failed" (message lost; non-array); no eligibility run | RED: 200 | RED: 200 | new `BatchControlsCheck` (same codec + eligibility validator, pre-write, id-prefixed message) |
| Create | `PanelService.create` -> `buildForCreate` | PanelService.scala:303 | RED for non-array (201, silently `[]`); non-object element / missing id already 400 | RED: 201 | RED: 201 | `OutputPanelConfig.decode` strict; `OutputControlSpec.validateList` via `OutputPanel.validateConfig`; `decodeCreateConfig` rejects the key on non-output |
| Batch create | `PanelService.batchCreate` -> `buildAllForCreate` -> `buildForCreate` | PanelService.scala:364,490 | RED (non-array) | RED | RED | same as Create (shared `buildForCreate`) |
| Duplicate panel | `PanelService.duplicate` -> `PanelMutationOps.duplicate` | PanelService.scala:~420 | N/A: copies the persisted row, accepts no controls input | N/A | N/A | none needed; round-trip pinned ("duplicate of a panel with controls" case) |
| Dashboard import | `DashboardService.importSnapshot` -> `validateImportPanels` | DashboardService.scala:365 | RED (non-array) | RED | RED | same seams (`decodeCreateConfig` + `validateConfig`); eligibility is deliberately not run on import (unchanged) |
| Snapshot write | `DashboardSnapshotRepository.importSnapshot` | DashboardSnapshotRepository.scala:174 | N/A: only reachable after `validateImportPanels`; replays exported (`encodeConfig`) data and must not reject legacy rows | N/A | N/A | none (decodeCreateConfig is now strict but exports always emit an array) |
| Contents replace (PUT) | `DashboardContentsService.replaceContents` -> `ProposalPanelSupport.validatePanel` + `buildPanels` -> `buildAllForCreate` | DashboardContentsService.scala:69,127 | RED (non-array via `config.controls`) | RED | RED | `ProposalPanelSupport.validateControlsShape`/`validateControlList` (propose-time, read-free) + `buildForCreate` seams |
| Proposal apply | `DashboardProposalService.validate/apply` -> `createPanels` -> `PanelService.create` | DashboardProposalService.scala:60,130 | RED (non-array: `controlSpecsOf` treated it as empty); other malformed shapes already 400 after a dashboard create+rollback | RED | RED | same as Contents replace (`validateControlsShape`) now rejects before any write |
| Patch-set apply / undo / rollback | `PatchSetApplyForward`/`PatchSetApplyRollback`/`PatchSetUndoService` -> `panelService.update/create` | PatchSetApplyForward.scala:33,39 | inherits PATCH/create | inherits | inherits | none needed (goes through the two seams above); patch-set PREVIEW uses `applyConfigPatch` and so shows the same rejection |
| MCP control tools (helio-mcp, HEL-1193) | `outputControlsHandlers.ts` -> `api.updatePanel(panelId, {config:{controls}})`; `apply_*_proposal` tools -> apply-proposal | helio-mcp/src/tools/outputControlsHandlers.ts:66 | inherits PATCH | inherits | MCP already pre-checks panel kind | none needed (HTTP PATCH / apply-proposal) |
| Frontend | `OutputControlsEditor` PATCH | frontend/src/features/panels/ | n/a | n/a | grep: `controls` is sent only for output panels (`panelPayloads.ts` seeds `controls: []` for output only) | none; D3 premise confirmed |
| Read-time row load | `PanelRowMapper.outputControlsOf` | PanelRowMapper.scala:112 | tolerant by design, unchanged (does not use the strict decode) | n/a | n/a | unchanged |

## Reproduction (RED on main, before any production change)

`sbt "testOnly com.helio.api.routes.panels.PanelControlsValidationSpec"` => `Tests: succeeded 15, failed 30`:
PATCH malformed -> `500 Internal Server Error` (x3, `DeserializationException: control must be an object / id is required`);
duplicate ids -> 2xx on PATCH, updateBatch, create, batch create, contents, apply-proposal, import (7);
controls on a text panel -> 2xx on all 7 paths x {`[]`, populated} (14);
non-array `controls` -> 2xx (silently emptied) on create, batch create, contents, apply-proposal, import (5);
PATCH-then-read: rejected dup list still persisted (1, "persist nothing").
Already 400 on main (not red): non-object element / missing id on create, batch create, contents, apply-proposal, import; all
three malformed shapes on updateBatch (generic message only).
