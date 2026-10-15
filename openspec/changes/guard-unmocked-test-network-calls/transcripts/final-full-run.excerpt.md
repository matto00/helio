# Final full run, cycle 2 (10 allowlisted files)

command: env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default
cwd: /home/matt/Development/helio/.claude/worktrees/task/mock-unmocked-test-network-calls/HEL-1600/frontend

## summary
Test Suites: 612 passed, 612 total
Tests:       7268 passed, 7268 total
Snapshots:   19 passed, 19 total

## FAIL files (0)

## PASS files: 612 (list omitted when > 20)

## distinct guard message lines (0)

## AggregateError blocks per file (total 241)
  130 src/features/pipelines/ui/PipelineDetailPage.test.tsx
   57 src/features/commandPalette/ui/CommandPalette.test.tsx
   21 src/app/App.test.tsx
   14 src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx
   12 src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx
    4 src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx
    2 src/features/panels/ui/PanelList.test.tsx
    1 src/app/AppShell.rail.test.tsx
