## 1. Backend builder
- [x] 1.1 Red-first: `FirstRunDashboardServiceSpec` (column classification incl. an MM/dd/yyyy column NOT date-like and an epoch-numeric column numeric, cast/shape selection incl. no-numeric table-only, <=3 outputs) failing first.
- [x] 1.2 `services/firstrun/FirstRunDashboardService` (rule per design 3-5): reads CSV sample, builds `PipelineProposal` (cast + shape steps), applies it, builds `DashboardProposal` with explicit full-width layouts (design 5), applies it, rolls the pipeline back on dashboard failure.
- [x] 1.3 Route `POST /api/first-run/dashboard` (authenticated, ownership-checked sourceId, not tier-gated) wired in `ApiRoutes.scala`; JSON protocol; schema + drift parity if a schema is added.
- [x] 1.4 Route spec with a counting `ClaudeTransport` double asserting ZERO calls on the full free-tier path; rollback spec; overlap-free, full-width PERSISTED-layout spec (read back from the repository) at lg/md/sm/xs for 1/2/3 panels; error-status spec.
## 2. Frontend
- [x] 2.1 Extract shared CSV create logic from `AddSourceModal` into `useCsvSourceCreate` (AddSourceModal behavior and tests unchanged).
- [x] 2.2 `FirstRunDropZone` (drop, file picker, URL paste, live-region progress, role=alert errors, retry) + `firstRunService` + thunk; DESIGN.md tokens, both themes, phone width.
- [x] 2.3 `/dashboards/:id` route + `DashboardRoute` wrapper; navigate after build.
- [x] 2.4 `PanelList` shows drop zone for zero dashboards, "Set up step by step" reveals checklist; update PanelList.onboarding tests.
- [x] 2.5 Beta/owner "Refine with the assistant" (tier from auth slice) + `ChatPage` draft prefill from `location.state`; hidden for free.
- [x] 2.6 Telemetry emits (`firstrun_file_dropped`, `firstrun_dashboard_created`) with tests; confirm no second `first_dashboard_rendered`.
- [x] 2.7 Component tests: keyboard path, announced progress/errors, tier visibility, failure states.
## 3. Spec and verification
- [x] 3.1 Update `first-run-onboarding` spec via this change's delta; fix stale wording at archive.
- [ ] 3.2 Live timing on a fresh FREE account (empty workspace -> rendered dashboard): record seconds and interaction count; phone width; light and dark; screenshots outside repo root. Delete test accounts and their sources/pipelines/dashboards by exact id before Phase 4.
- [x] 3.3 Maintain `files-modified.md`.

## Standing Constraints
- [C1] The zero-Claude assertion is red-first and structural: a counting ClaudeTransport double on the full free-tier route; the evaluator first reproduces today's empty workspace (checklist, no drop zone) on main.
- [C2] The exit criterion (<= 60 s, <= 5 interactions, fresh FREE account) is measured live against the running app and recorded with numbers; no completion claim without it.
- [C3] Fresh test accounts are deleted by exact id (users, sources, pipelines, dashboards) before Phase 4, or the residue is listed.
