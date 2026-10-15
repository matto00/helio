# Allowlist run 1 (cycle 2, 10 files incl. processedWidth)

command: env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default --testPathPatterns <10 allowlisted files>
cwd: /home/matt/Development/helio/.claude/worktrees/task/mock-unmocked-test-network-calls/HEL-1600/frontend

## summary
Test Suites: 10 passed, 10 total
Tests:       252 passed, 252 total
Snapshots:   0 total

## FAIL files (0)

## PASS files: 10 (list omitted when > 20)
PASS src/app/App.test.tsx
PASS src/app/AppShell.rail.test.tsx
PASS src/features/commandPalette/ui/CommandPalette.test.tsx
PASS src/features/panels/ui/PanelList.test.tsx
PASS src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx
PASS src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx
PASS src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx
PASS src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx
PASS src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx
PASS src/features/pipelines/ui/PipelineDetailPage.test.tsx

## distinct guard message lines (0)

## AggregateError blocks per file (total 245)
  130 src/features/pipelines/ui/PipelineDetailPage.test.tsx
   57 src/features/commandPalette/ui/CommandPalette.test.tsx
   23 src/app/App.test.tsx
   14 src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx
   12 src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx
    4 src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx
    2 src/features/panels/ui/PanelList.test.tsx
    2 src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx
    1 src/app/AppShell.rail.test.tsx
