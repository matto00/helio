## Why

A brand-new (free-tier) user lands on an empty workspace with a 3-step checklist that sends them to three separate pages. Owner ruling: the first run is non-AI for everyone and must reach a rendered dashboard from a dropped CSV in <= 60 s and <= 5 interactions. Beta/owner additionally get an AI refine action; free users never see it.

## What Changes

- Backend: a deterministic, rule-based first-run builder (`POST /api/first-run/dashboard {sourceId}`) that reads the already-created CSV source's header and sample rows, detects column types (state the heuristic), selects shapes from the existing pipeline-shapes registry, applies the pipeline (running it) and creates a dashboard with a mobile-safe layout, atomically with rollback. It has no Claude dependency.
- Frontend: the empty-workspace landing (zero dashboards) shows a drop zone, a paste-a-URL field and a file picker. It reuses the existing CSV create service functions (no fork of AddSourceModal's infer->create logic: the shared logic is extracted into a hook used by both). It then calls the builder and navigates to a new authenticated `/dashboards/:id` route.
- Frontend: "Refine with the assistant" on the landed dashboard, visible only when `auth.currentUser.tier` is `beta` or `owner`, opens the chat with a prefilled draft naming the new source and pipeline.
- Telemetry: emit `firstrun_file_dropped` (`source: drop|paste`; file picker counts as drop) and `firstrun_dashboard_created` (`panelCount`) via `track()`; `first_dashboard_rendered` fires naturally from PanelCard and is not emitted again.
- Failure states with announced (`role=alert`) errors: unparseable/empty CSV, oversized file (413), URL fetch failure (400/502/413), no-numeric-column CSV (still produces a table dashboard).
- Spec: `first-run-onboarding` is corrected (3 steps, not 4/"type") and amended: the drop zone supersedes the checklist as the zero-dashboard landing; the checklist remains reachable via "Set up step by step".

## Capabilities

### New Capabilities
- `first-run-dashboard-build`: the deterministic builder, type-detection/shape-selection rule, atomic apply, drop-zone landing, dashboard route, beta refine action, telemetry and failure states.

### Modified Capabilities
- `first-run-onboarding`: stale 4-step wording corrected; checklist is no longer the first thing a zero-dashboard user sees.

## Impact

Backend: new `services/firstrun/` service + route wired in `ApiRoutes.scala` (no migration expected; V114 untouched). Frontend: `features/onboarding/`, `app/AppRoutes.tsx`, `features/dashboards/`, `features/assistant/` (draft prefill), telemetry call sites. Schemas/drift script if a request/response schema is added.
