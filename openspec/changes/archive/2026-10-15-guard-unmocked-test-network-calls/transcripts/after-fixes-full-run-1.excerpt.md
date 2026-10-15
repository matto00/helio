# After fixes, run 1 (cycle 1)

command: env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default
cwd: /home/matt/Development/helio/.claude/worktrees/task/mock-unmocked-test-network-calls/HEL-1600/frontend

## summary
Test Suites: 9 failed, 602 passed, 611 total
Tests:       179 failed, 7086 passed, 7265 total
Snapshots:   19 passed, 19 total

## FAIL files (18)
FAIL src/app/App.test.tsx
FAIL src/app/AppShell.rail.test.tsx
FAIL src/features/commandPalette/ui/CommandPalette.test.tsx
FAIL src/features/panels/ui/PanelList.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx
FAIL src/features/pipelines/ui/PipelineDetailPage.test.tsx

## PASS files: 602 (list omitted when > 20)

## distinct guard message lines (239)
- GET /api/connector-types (in "App HEL-516 design.md D3a — StrictMode-masked production defect, closed by the shell mount opens the shell-mounted AddSourceModal in place on /sources/:id, and dismissing it via onClose leaves no dialog on a later /sources visit")
- GET /api/connector-types (in "App HEL-516 shell-mounted create surfaces does NOT double-mount AddSourceModal on /sources itself (the owning route mounts its own)")
- GET /api/connector-types (in "App HEL-516 shell-mounted create surfaces mounts AddSourceModal from a non-/sources route when addModalOpen is set")
- GET /api/connectors (in "App HEL-516 design.md D3a — StrictMode-masked production defect, closed by the shell mount opens the shell-mounted AddSourceModal in place on /sources/:id, and dismissing it via onClose leaves no dialog on a later /sources visit")
- GET /api/connectors (in "App HEL-516 shell-mounted create surfaces does NOT double-mount AddSourceModal on /sources itself (the owning route mounts its own)")
- GET /api/connectors (in "App HEL-516 shell-mounted create surfaces mounts AddSourceModal from a non-/sources route when addModalOpen is set")
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
- GET /api/data-sources (in "PanelList the step-by-step checklist's 'New dashboard' action creates a dashboard (F-003, HEL-1209)")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) Retry shows the steps skeleton while in flight, then the persisted step cards")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) Retry that fails again shows the error again")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) a Retry that settles after the page unmounted dispatches no analyze")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) does not report a step count while the steps are unknown (no '0 steps')")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) shows the steps error with Retry, not the empty editor, when the steps fetch rejects")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) when analyze also failed at mount, a successful Retry re-requests analyze once")
- GET /api/data-sources (in "PipelineDetailPage -- steps fetch failure (HEL-1501) when analyze succeeded at mount, Retry does not re-request it")
- GET /api/data-sources (in "handleReorderSteps CR2 guard (DEFENSE-IN-DEPTH branch, no live path) a root that had steps but whose trunk lane comes back empty is refused: error toast naming the root, no PUT, no optimistic state change")
- GET /api/outputs/output-1 (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs/output-1 (in "App saves panel appearance changes via the API and returns to view mode")
- GET /api/outputs/output-1/assertion-status (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs/output-1/assertion-status (in "App saves panel appearance changes via the API and returns to view mode")
- GET /api/outputs/output-1/filter-capabilities (in "App saves panel appearance changes via the API and returns to view mode")
- GET /api/outputs/output-1/panels (in "App saves panel appearance changes via the API and returns to view mode")
- GET /api/outputs/output-1/rows?offset=0&limit=200 (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs/output-1/rows?offset=0&limit=200 (in "App saves panel appearance changes via the API and returns to view mode")
- GET /api/outputs/output-2 (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs/output-2/assertion-status (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs/output-2/rows?offset=0&limit=200 (in "App keeps panel content visible when switching dashboards")
- GET /api/outputs?offset=0&limit=200 (in "App HEL-516 shell-mounted create surfaces mounts OutputPicker from a non-/ route when the store's panels already belong to the selected dashboard")
- GET /api/outputs?offset=0&limit=200 (in "App HEL-516 shell-mounted create surfaces mounts OutputPicker off-route for a dashboard with GENUINELY zero panels, once its fetch has resolved")
- GET /api/outputs?offset=0&limit=200 (in "App quick-launcher Cmd/Ctrl+K no longer opens the quick-launcher (it opens the command palette instead)")
- GET /api/outputs?offset=0&limit=200 (in "CommandPalette Cmd/Ctrl+K opens the palette with its input focused")
- GET /api/outputs?offset=0&limit=200 (in "CommandPalette Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input")
- GET /api/outputs?offset=0&limit=200 (in "CommandPalette Enter runs the active result exactly once and closes the palette")
- GET /api/outputs?offset=0&limit=200 (in "CommandPalette Escape closes the palette")
- GET /api/outputs?offset=0&limit=200 (in "CommandPalette arrow keys move the active result and wrap at the ends")

## AggregateError blocks per file (total 0)
