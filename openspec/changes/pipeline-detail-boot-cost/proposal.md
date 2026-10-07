## Why

HEL-1298 measured the pipeline-detail page booting with 7 parallel API calls, one of them a duplicate
`GET /api/pipelines/:id/runs`, and the Outputs tab taking 2.6-3.4 s to become clickable at 6x CPU throttle (0.19 s
idle). The hel910 e2e still runs 26.8-28.0 s against a 30 s timeout at 8x, so the page's boot cost is both a slow-device
user cost and a CI flake margin. These numbers are claims from another run; this change re-measures them first.

## What Changes

- Probe and prove the root cause of the duplicate run-history GET, then remove it at that cause.
- Stop fetching run history on boot when nothing on first paint needs it: fetch it when the run-history modal opens,
  or on boot only when the persisted truncation banner needs it (`lastRunTruncated === true`).
- The run-history modal shows a loading state (not "No runs recorded yet") while its fetch is in flight, and an error
  state if it fails.
- Audit every other boot call against first paint; defer or consolidate any that first paint does not need, decided
  by probe evidence, not assumption.
- Record before/after measurements: boot request count, Outputs-tab time-to-interactive (idle and 6x), and hel910
  duration at HEL-1298's 8x configuration.

## Capabilities

### New Capabilities

### Modified Capabilities

- `pipeline-editor-page`: adds a requirement bounding the page's boot requests (no duplicate GET of one resource per
  page open; run history loaded on demand) and the run-history modal's loading/error states.

## Impact

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`, `state/pipelinesSlice.ts`,
  `ui/PipelineDetailPage.tsx`, `ui/RunHistoryModal.tsx`, and their RTL tests.
- No backend, API-contract, schema, or migration change.

## Non-goals

- The Output editor sheet and `buildChartOption` (sibling HEL-1350 is in flight there).
- `ci.yml`, `playwright.config.ts`, `.gitignore`, and hel910's 30 s ceiling.
- New backend endpoints to consolidate calls (a follow-up if the probes show a consolidation would pay).
- Disabling React StrictMode.
