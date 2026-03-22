## 1. Database Migration

- [ ] 1.1 Create `V3__panel_type.sql` adding `type TEXT NOT NULL DEFAULT 'metric'` to the `panels` table

## 2. Backend Domain Model

- [ ] 2.1 Add `sealed trait PanelType` with `case object` variants (`Metric`, `Chart`, `Text`, `Table`) to `model.scala`
- [ ] 2.2 Add `panelType: PanelType` field to the `Panel` case class in `model.scala`

## 3. Backend Repository

- [ ] 3.1 Add `panelType` field to `PanelRow` in `PanelRepository.scala`
- [ ] 3.2 Add `type` column mapping to `PanelTable` in `PanelRepository.scala`
- [ ] 3.3 Update `rowToDomain` and `domainToRow` to include `panelType`

## 4. Backend API Layer

- [ ] 4.1 Add `PanelType` JSON format (`JsonFormat[PanelType]`) to `JsonProtocols.scala`, rejecting unknown values with a descriptive error
- [ ] 4.2 Add `type: Option[PanelType]` to `CreatePanelRequest` and update its JSON format (arity bump)
- [ ] 4.3 Add `type: Option[PanelType]` to `UpdatePanelRequest` and update its JSON format (arity bump)
- [ ] 4.4 Add `type: String` to `PanelResponse` and update its JSON format and `fromDomain` (arity bump)
- [ ] 4.5 Update panel creation in `ApiRoutes.scala` to apply `request.type` (default `Metric`)
- [ ] 4.6 Update panel update (`PATCH`) in `ApiRoutes.scala` to handle `type` changes — add `updateType` method to `PanelRepository` and wire it in
- [ ] 4.7 Update `DemoData.scala` to assign sensible types to seed panels (`Metric` for numeric panels, etc.)

## 5. JSON Schemas

- [ ] 5.1 Add `type` enum property (`metric | chart | text | table`) to `schemas/panel.schema.json` (required field)
- [ ] 5.2 Add optional `type` enum property to `schemas/create-panel-request.schema.json`

## 6. Frontend

- [ ] 6.1 Add `PanelType` union type and `type` field to `Panel` interface in `frontend/src/types/models.ts`
- [ ] 6.2 Add optional `type` parameter to `createPanel` in `frontend/src/services/panelService.ts`
- [ ] 6.3 Update `createPanel` thunk in `frontend/src/features/panels/panelsSlice.ts` to accept and forward `type`

## 7. Verification

- [ ] 7.1 Run `sbt test` in `backend/` — all backend tests pass
- [ ] 7.2 Run `npm test` in `frontend/` — all frontend tests pass
- [ ] 7.3 Run `npm run lint` and `npm run format:check` in `frontend/` — zero warnings
- [ ] 7.4 Run `npm run build` in `frontend/` — clean build
