# Inventory run (guard, empty allowlist)

command: env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default
cwd: /home/matt/Development/helio/.claude/worktrees/task/mock-unmocked-test-network-calls/HEL-1600/frontend

## summary
Test Suites: 40 failed, 571 passed, 611 total
Tests:       335 failed, 6930 passed, 7265 total
Snapshots:   19 passed, 19 total

## FAIL files (80)
FAIL src/app/App.test.tsx
FAIL src/app/AppShell.rail.test.tsx
FAIL src/features/commandPalette/ui/CommandPalette.test.tsx
FAIL src/features/panels/ui/PanelCard.crossFilter.test.tsx
FAIL src/features/panels/ui/PanelCard.filterEmptyState.test.tsx
FAIL src/features/panels/ui/PanelCardBody.predispatch.test.tsx
FAIL src/features/panels/ui/PanelContent.test.tsx
FAIL src/features/panels/ui/PanelList.test.tsx
FAIL src/features/panels/ui/detailModal/PanelDetailModal.aggregateChart.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.derivedLayout.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.inflightResponse.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.layoutCommit.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.layoutConflict.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.layoutPatch.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.placementVersion.test.tsx
FAIL src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx
FAIL src/features/panels/ui/grid/MobilePanelStack.provenance.test.tsx
FAIL src/features/panels/ui/grid/MobilePanelStack.test.tsx
FAIL src/features/panels/ui/grid/PanelGrid.test.tsx
FAIL src/features/pipelines/hooks/usePipelineDetailPage.identity.test.tsx
FAIL src/features/pipelines/ui/CreatePipelineModal.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.runHistory.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.skeletonDom.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.test.tsx
FAIL src/features/pipelines/ui/StepCard.blurNoRepatch.test.tsx
FAIL src/features/pipelines/ui/StepCard.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/JoinConfig.seam.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/JoinConfig.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/LookupConfig.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/LookupConfig.uniqueId.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/SecondaryInputPicker.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/UnionConfig.test.tsx
FAIL src/features/pipelines/ui/stepConfigs/UpsertSourceConfig.test.tsx
FAIL src/features/sources/ui/SourcesPage.test.tsx
FAIL src/test/panelActionsAccessibleName.test.tsx
FAIL src/test/rawElementGuardHel440.test.tsx

## PASS files: 571 (list omitted when > 20)

## distinct guard message lines (463)
- GET /api/connector-types (in "App HEL-516 design.md D3a — StrictMode-masked production defect, closed by the shell mount opens the shell-mounted AddSourceModal in place on /sources/:id, and dismissing it via onClose leaves no dialog on a later /sources visit")
- GET /api/connector-types (in "App HEL-516 shell-mounted create surfaces does NOT double-mount AddSourceModal on /sources itself (the owning route mounts its own)")
- GET /api/connector-types (in "App HEL-516 shell-mounted create surfaces mounts AddSourceModal from a non-/sources route when addModalOpen is set")
- GET /api/connector-types (in "CreatePipelineModal opens AddSourceModal when 'Create a new source' is activated, and pre-selects the created source on close")
- GET /api/connector-types (in "SourcesPage add-source modal flag reset on unmount (HEL-554 D4) does not reopen the modal on a fresh mount after a prior instance unmounted with the flag left true")
- GET /api/connector-types (in "SourcesPage add-source modal flag reset on unmount (HEL-554 D4) verifies the unmount path directly: opening the modal, navigating away, and returning does not re-open it")
- GET /api/connectors (in "App HEL-516 design.md D3a — StrictMode-masked production defect, closed by the shell mount opens the shell-mounted AddSourceModal in place on /sources/:id, and dismissing it via onClose leaves no dialog on a later /sources visit")
- GET /api/connectors (in "App HEL-516 shell-mounted create surfaces does NOT double-mount AddSourceModal on /sources itself (the owning route mounts its own)")
- GET /api/connectors (in "App HEL-516 shell-mounted create surfaces mounts AddSourceModal from a non-/sources route when addModalOpen is set")
- GET /api/connectors (in "CreatePipelineModal opens AddSourceModal when 'Create a new source' is activated, and pre-selects the created source on close")
- GET /api/connectors (in "SourcesPage add-source modal flag reset on unmount (HEL-554 D4) does not reopen the modal on a fresh mount after a prior instance unmounted with the flag left true")
- GET /api/connectors (in "SourcesPage add-source modal flag reset on unmount (HEL-554 D4) verifies the unmount path directly: opening the modal, navigating away, and returning does not re-open it")
- GET /api/connectors (in "authenticated shell: icon rail and context list (HEL-1574) above the phone breakpoint shows no context list on Connectors, without changing the saved collapsed state")
- GET /api/dashboards (in "CommandPalette Cmd/Ctrl+K opens the palette with its input focused")
- GET /api/dashboards (in "CommandPalette Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input")
- GET /api/dashboards (in "CommandPalette Enter runs the active result exactly once and closes the palette")
- GET /api/dashboards (in "CommandPalette Escape closes the palette")
- GET /api/dashboards (in "CommandPalette arrow keys move the active result and wrap at the ends")
- GET /api/dashboards (in "CommandPalette renders a KeyCap per token for an action with a shortcut, and none for an action without")
- GET /api/dashboards (in "CommandPalette renders sections in the DECLARED order, even when the action list encounters them out of order")
- GET /api/dashboards (in "CommandPalette reopening starts from a clean query showing the full default list")
- GET /api/dashboards (in "CommandPalette shows the empty state when the query matches nothing, and Enter is a no-op")
- GET /api/dashboards (in "CommandPalette — Recent section (HEL-519) an empty history leaves the default presentation COMPLETELY unchanged")
- GET /api/dashboards (in "CommandPalette — Recent section (HEL-519) renders all three kinds on / with NO slice loaded (skeptic-final-1.md CR1)")
- GET /api/dashboards (in "CommandPalette — Recent section (HEL-519) typing a query leaves recents behind (task 5.1/D5)")
- GET /api/dashboards (in "CommandPalette — search-result overflow row is non-interactive (skeptic-final-1.md CR2) arrowing through every option never reaches the overflow notice")
- GET /api/dashboards (in "CommandPalette — search-result overflow row is non-interactive (skeptic-final-1.md CR2) the overflow notice is on screen but is NOT among the palette's options")
- GET /api/data-sources (in "CommandPalette Cmd/Ctrl+K opens the palette with its input focused")
- GET /api/data-sources (in "CommandPalette Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input")
- GET /api/data-sources (in "CommandPalette Enter runs the active result exactly once and closes the palette")
- GET /api/data-sources (in "CommandPalette Escape closes the palette")
- GET /api/data-sources (in "CommandPalette arrow keys move the active result and wrap at the ends")
- GET /api/data-sources (in "CommandPalette renders a KeyCap per token for an action with a shortcut, and none for an action without")
- GET /api/data-sources (in "CommandPalette renders sections in the DECLARED order, even when the action list encounters them out of order")
- GET /api/data-sources (in "CommandPalette reopening starts from a clean query showing the full default list")
- GET /api/data-sources (in "CommandPalette shows the empty state when the query matches nothing, and Enter is a no-op")
- GET /api/data-sources (in "CommandPalette — Recent section (HEL-519) an empty history leaves the default presentation COMPLETELY unchanged")
- GET /api/data-sources (in "CommandPalette — Recent section (HEL-519) renders all three kinds on / with NO slice loaded (skeptic-final-1.md CR1)")
- GET /api/data-sources (in "JoinConfig a stored lane reference is shown, not replaced")
- GET /api/data-sources (in "JoinConfig clicking a join type button emits it")
- GET /api/data-sources (in "JoinConfig does not call onChange on mount")
- GET /api/data-sources (in "JoinConfig flags an unsupported stored joinType, presses neither button, and does not coerce it")
- GET /api/data-sources (in "JoinConfig matches join type case-insensitively, as the backend does")
- GET /api/data-sources (in "JoinConfig notes the right_<name> collision prefix")
- GET /api/data-sources (in "JoinConfig offers a stored key missing from the input schema, labelled, and keeps it selected")
- GET /api/data-sources (in "JoinConfig offers data sources and other lane nodes as the right input")
- GET /api/data-sources (in "JoinConfig offers exactly INNER and LEFT, with the stored one pressed and described")
- GET /api/data-sources (in "JoinConfig selecting a data source emits a source-kind secondary, other fields unchanged")
- GET /api/data-sources (in "JoinConfig selecting a join key from analyzeSchema emits it")
- GET /api/data-sources (in "JoinConfig selecting a lane node emits a lane-kind secondary")
- GET /api/data-sources (in "LookupConfig clicking Add column appends an empty column row")
- GET /api/data-sources (in "LookupConfig editing a column row calls onChange with the updated column name")
- GET /api/data-sources (in "LookupConfig editing the reference match field (lookupKey) input calls onChange with the updated value")
- GET /api/data-sources (in "LookupConfig populates the match-on-field picker from analyzeSchema")
- GET /api/data-sources (in "LookupConfig populates the reference picker with available sources AND other lane nodes")
- GET /api/data-sources (in "LookupConfig reference-match-field id gives each lookup card its own input id, used exactly once in the document")
- GET /api/data-sources (in "LookupConfig reference-match-field id points each card's label htmlFor at that card's own input")
- GET /api/data-sources (in "LookupConfig removing a column row calls onChange without that row")
- GET /api/data-sources (in "LookupConfig renders a text row per persisted column")
- GET /api/data-sources (in "LookupConfig selecting a reference source calls onChange with a source-kind secondary, other fields unchanged")

## AggregateError blocks per file (total 0)
