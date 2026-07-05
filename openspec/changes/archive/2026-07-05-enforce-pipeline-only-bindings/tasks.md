# Tasks — enforce-pipeline-only-bindings

### Backend

- [x] 1.1 V41 migration: pass-through pipeline + `source_id` clear + replacement companion for every panel-bound companion DataType (D1)
- [x] 1.2 Guard `POST /api/panels` / `PATCH /api/panels/:id`: 400 when the referenced DataType has `sourceId` set (D2)
- [x] 1.3 Align `DemoData` seeding with the guard: demo panels bind pipeline-output types only

### Frontend

- [x] 2.1 Delete `PanelLegacyWarning` (+CSS), `useLegacyBoundPanel`, `PanelCard` mount (D4)
- [x] 2.2 Add `selectPipelineOutputDataTypes`; use in BindingEditor (drop source badge), panel-creation DataType step, Type Registry sidebar/browser (D3)
- [x] 2.3 Replace `SourceSelectorBar`/`SourceChip` with read-only bound-source display on pipeline detail (D5)
- [x] 2.4 Sources page: fetch pipelines; delete warning based on dependent pipelines (D6)
- [x] 2.5 Copy fixes: Type Registry empty states reference pipeline outputs, not source connection/inputs

### Tests

- [x] 3.1 Backend: guard rejection tests (POST + PATCH, companion vs pipeline-output type)
- [x] 3.2 Backend: migration outcome covered via repository-level test against migrated schema (Flyway applies V41 in EmbeddedPostgres)
- [x] 3.3 Frontend: remove legacy-warning tests; update BindingEditor/creation-step/registry tests for filtered lists
- [x] 3.4 Frontend: DataSourceList delete-warning tests keyed on pipelines
- [x] 3.5 Gates: `npm run lint`, `npm run format:check`, `npm test`, `sbt test` all green
