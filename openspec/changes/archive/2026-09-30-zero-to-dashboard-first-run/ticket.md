# HEL-1209: Zero-to-dashboard first run: drop or paste a CSV on an empty workspace → auto-built dashboard (no AI), plus "refine with assistant" for beta

## Description

Leaf 4 of HEL-916. A brand-new user should go from an empty workspace to a rendered dashboard from a dropped CSV in <= 60 s and <= 5 interactions. Today the empty workspace shows a 3-step checklist (`features/onboarding/`). Owner ruling: a non-AI path for everyone (new signups are `free`; free users get 403 from the assistant), with AI refinement as an extra for beta/owner.

Scope:
- Empty-workspace landing becomes a drop zone plus paste-a-URL field plus a file picker (keyboard/touch). Decide supersede vs fold into checklist step 1; update the stale `first-run-onboarding` spec.
- Deterministic build, no Claude call: (1) file/URL becomes a CSV source via the existing route (reuse AddSourceModal infer->create, don't fork); (2) default pipeline + outputs chosen by rule from inferred columns using the pipeline-shapes registry (time_series for date-like + numeric, top_n for categorical + numeric, always a passthrough table); CSV columns infer as strings so state the cast/detect heuristic; (3) dashboard with auto-layout including mobile layout; (4) run the pipeline so panels render real data, land the user ON a dashboard URL.
- Atomic preferred: consider CombinedProposalService.apply with a rule-built proposal.
- Beta/owner extra: "Refine with the assistant" on the landed dashboard (hidden for free users, not shown-then-403).
- Emit firstrun_file_dropped and firstrun_dashboard_created (HEL-1208 track()).
- Failure states: unparseable CSV, oversized (CsvUrlFetch.maxFileSizeBytes), URL fetch failure, CSV with no numeric columns (still a table dashboard).

## Acceptance Criteria

- Timed live on a fresh free-tier account from an empty workspace: dropped sample CSV -> rendered dashboard in <= 60 s and <= 5 interactions, both measured and recorded. Also verified at phone width and in both themes.
- No Claude call on the free path (asserted: a test double sees zero calls).
- A beta user sees the refine action; a free user doesn't.
- a11y: drop zone has a keyboard/touch equivalent; progress and errors are announced.

## Owner rulings and driver notes

- First run is NON-AI for everyone; zero Claude calls on the drop-to-dashboard path. Beta/owner get "Refine with the assistant" via the gated assistant; hidden for free.
- Use HEL-1205 tier gate (ChatAccessService) or user tier; no parallel tier check.
- Use client track() for firstrun_file_dropped / firstrun_dashboard_created; first_dashboard_rendered fires on its own, do not emit twice. Persona templates and HEL-1218 are HEL-1210, not this ticket.
- Landing must be a dashboard URL (none authenticated exists today; only public viewer /dashboards/:id/panels and "/"). Include mobile layout (HEL-1071 overlap hazard). Pipeline must run before "rendered".
- Migration, if needed: V114 (tell driver first).
