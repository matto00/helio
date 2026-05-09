## 1. Backend

- [x] 1.1 Fix `applyRename` in `InProcessPipelineEngine` to parse `{"renames": {"from":"to"}}` map shape (replace current `mappings` array logic)
- [x] 1.2 Add rename test cases to `InProcessPipelineEngineSpec`: multiple renames, missing source field silently ignored, empty renames map is no-op

## 2. Frontend

- [x] 2.1 Create `RenameFieldsConfig.tsx` component: table of (source field name | target name text input) rows; empty table when `columns` is empty
- [x] 2.2 Create `RenameFieldsConfig.test.tsx`: renders one row per column, empty table when no columns, text input change fires callback
- [x] 2.3 Add `parseRenames` helper in `PipelineDetailPage.tsx` to extract `renames` map from a persisted step config string
- [x] 2.4 Extend `StepCard` in `PipelineDetailPage.tsx` to manage `renames` state (during-render sync pattern matching `selectedFields`)
- [x] 2.5 Wire `RenameFieldsConfig` into `StepCard` body for `op === "rename"`; call `updatePipelineStep` on each text input change
- [x] 2.6 Set initial config for rename steps to `'{"renames":{}}'` in `handleAddStep`
- [x] 2.7 Add/extend `PipelineDetailPage.test.tsx` tests: rename step card shows field rows from analyze, text input change PATCHes config, hydrates from persisted config on reload
