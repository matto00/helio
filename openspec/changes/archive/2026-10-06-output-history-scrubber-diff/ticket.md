# HEL-1277: HEL-918 L7: Pipeline run scrubber, chart vs-overlay, table changed-rows highlight

## Description

Leaf L7 of epic HEL-918 (Snapshot history & deltas on every Output). Owner rulings D1–D10 (HEL-918, 2026-10-05) are binding:

- D1 Storage: summary first — every real run stores a per-Output summary (row_count, per-numeric-column {count,sum,min,max} cap ~20 columns, server headline metric, reduced chart x→y series cap ~200 points). Full row payloads (L6) opt-in, tight retention, one JSONB array per node per run.
- D2 `compare` lives on outputs.config.compare (previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>).
- D3 Canonical metric server-side over ALL rows; with a viewer control filter active the delta is hidden, tooltip "comparison reflects unfiltered data".
- D4 Retention: write every run, thin on purge; payload tier caps free 0, beta 10 runs/7d, owner 30 runs/30d.
- D5 Only real, unblocked, successful runs record history.
- D6 Baseline = nearest point at or before (latest captured_at − window); none → baseline null + availableFrom. previous_run = second-newest point.
- D7 run_id TEXT NULL no FK; trigger_source and captured_at on the history row.
- D8 Keyed by output_id; sharing-aware RLS; public dashboards get the summary, never payloads.
- D9 Summary insert in the same transaction as the snapshot replace.
- D10 Alert baselines last (L8).

## Scope

- A scrubber over history points in RunHistoryModal or OutputsGalleryTab.
- A labelled "vs" overlay series in buildChartOption.
- A changed-rows diff in TableRenderer. Decide the diff keying (key column vs row_index) at design time; escalate if a product call.

## Acceptance Criteria

- Scrubbing shows each point's summary, and its rows when a payload exists.
- The overlay series is labelled.
- Light and dark visual checks.

## Driver constraints (2026-10-06, binding for this run)

- Points without a payload (opted out, over cap, free tier, thinned) degrade to summary only with NO changed-rows highlight; never show rows as removed when a payload is merely missing.
- No UI/MCP toggle for historyPayloads (HEL-1331); seed via PATCH in tests.
- No UI copy promising "previous run" (HEL-1285 open).
- D8: public gets summary only; public payload path → 401.
- DESIGN.md binding; verify against the running app in both themes.
- e2e uses e2e/support/isolateLivePage.ts; never API-seed while a post-login `/` is live.
- Do not touch playwright.config.ts, ci.yml e2e/security jobs, .gitignore.
- No migration expected; V117 is next and must be cleared with the driver before claiming.

## Touches

frontend/src/features/pipelines/ui/RunHistoryModal.tsx, OutputsGalleryTab.tsx, panels/ui/buildChartOption.ts, panels/ui/renderers/TableRenderer.tsx

## Depends on

L5 (HEL-1275), L6 (HEL-1276) — both merged.
