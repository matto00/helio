## 1. Backend — read path

### Backend

- [ ] 1.1 Add per-subtype `ConfigResponse` formats (Metric/Chart/Table/Text/Markdown/Image/Divider) in `domain/panels/*.scala` companions
- [ ] 1.2 Rewrite `PanelResponse.fromDomain` (`PanelProtocol.scala:78`) to emit `type` + typed `config`; drop the 8 flat nullable fields from `PanelResponse` case class and adjust `panelResponseFormat`
- [ ] 1.3 Rewrite `DashboardSnapshotPanelEntry.fromDomain` to emit `type` + typed `config`; close the pre-existing Image/Divider data-loss bug
- [ ] 1.4 Bump snapshot version constant; reject prior-version snapshots in importer with 400
- [ ] 1.5 Update `PanelResponse` `jsonFormat15` → typed shape via custom `RootJsonFormat` dispatching on `type`

## 2. Backend — write path

### Backend

- [ ] 2.1 Add per-subtype `CreateConfig` request decoders (one per subtype) in `domain/panels/*.scala` companions; each `decode("{}")` defaults
- [ ] 2.2 Add per-subtype `UpdateConfig` request decoders with absent-vs-null per-field semantics (`Option[Option[_]]`) for binding-capable subtypes
- [ ] 2.3 Replace `CreatePanelRequest` (`PanelProtocol.scala:40`) flat shape with `{ dashboardId, title?, type, config }` + custom `RootJsonFormat` dispatcher
- [ ] 2.4 Replace `UpdatePanelRequest` (`PanelProtocol.scala:48`) flat shape with `{ title?, appearance?, type?, config? }` + custom `RootJsonFormat` dispatcher
- [ ] 2.5 Replace `PanelBatchItem` (`PanelProtocol.scala:61`) flat shape with `{ id, title?, appearance?, type?, config? }`
- [ ] 2.6 Update `PanelService.create` to dispatch on `type` + typed `config` and construct the matching Panel subtype
- [ ] 2.7 Update `PanelService.update` to dispatch on `type` + typed `config`; preserve cross-type PATCH 400 lock
- [ ] 2.8 Update `PanelService` batch-update to consume typed batch items with cross-type 400 lock
- [ ] 2.9 If `PanelService` crosses 300L soft cap, extract per-subtype helpers per design D6

## 3. Schemas

### Backend

- [ ] 3.1 Evolve `schemas/panel.schema.json` in place to a `oneOf` on `type` with per-subtype `config` `$defs`
- [ ] 3.2 Evolve `schemas/create-panel-request.schema.json` in place to `{ dashboardId, title?, type, config }`
- [ ] 3.3 Evolve `schemas/update-panels-batch-request.schema.json` to require `{ type, config }` per panel entry
- [ ] 3.4 Evolve `schemas/update-panels-batch-response.schema.json` to match the new `panel.schema.json` shape

## 4. Frontend — extractions before union

### Frontend

- [ ] 4.1 Extract `Panel` union + per-subtype config types from `models.ts` into `frontend/src/types/panel.ts`; re-export from `models.ts`
- [ ] 4.2 Extract `panelsSlice.ts` narrowing helpers into `frontend/src/features/panels/panelNarrowing.ts`
- [ ] 4.3 Extract `panelsSlice.ts` thunk payload builders into `frontend/src/features/panels/panelPayloads.ts`
- [ ] 4.4 Extract `PanelDetailModal.tsx` per-subtype editors into `frontend/src/components/panels/editors/<Subtype>Editor.tsx` (7 files)
- [ ] 4.5 Extract `PanelGrid.tsx` per-subtype renderers into `frontend/src/components/panels/renderers/<Subtype>Renderer.tsx` (7 files)

## 5. Frontend — discriminated union migration

### Frontend

- [ ] 5.1 Define `Panel` in `panel.ts` as discriminated union over `type` with typed `config` per subtype
- [ ] 5.2 Update `panelsSlice` thunks to read/write `{ type, config }` shape; preserve absent-vs-null on PATCH
- [ ] 5.3 Update `panelsService` axios calls to send and receive typed `config`
- [ ] 5.4 Migrate `PanelGrid` to dispatch on `type` via extracted renderers
- [ ] 5.5 Migrate `PanelDetailModal` to dispatch on `type` via extracted editors
- [ ] 5.6 Sweep the ~21 consumer sites that read flat nullable fields; migrate to narrowing
- [ ] 5.7 Verify every touched file ends ≤400L; extract further if needed

## 6. Tests

### Tests

- [ ] 6.1 Backend unit: each subtype's `CreateConfig` and `UpdateConfig` `decode("{}")` returns defaults
- [ ] 6.2 Backend unit: PATCH absent-vs-null per config field round-trips through `UpdatePanelRequest`
- [ ] 6.3 Backend unit: cross-type PATCH on `PanelService.update` returns 400
- [ ] 6.4 Backend integration: snapshot export → import round-trip preserves Image and Divider config fields
- [ ] 6.5 Backend integration: prior-version snapshot import returns 400
- [ ] 6.6 Frontend Jest: panelsSlice thunks emit typed `config` payload for create/update/batch
- [ ] 6.7 Frontend Jest: narrowing helpers correctly discriminate on `type` for all 7 subtypes
- [ ] 6.8 Playwright Phase 3 smoke: create/edit/delete each of 7 subtypes, snapshot round-trip, HEL-242 regression check
- [ ] 6.9 Gate: lint/format/test (frontend + backend) + pre-commit no-inline-FQN hook + file-size budgets
