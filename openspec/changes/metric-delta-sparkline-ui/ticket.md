# HEL-1275: HEL-918 L5: Metric delta + sparkline UI, server headline, compare picker

## Description

Leaf L5 of epic HEL-918 (snapshot history & deltas on every Output). Frontend only: consume L3's
history/delta read API (HEL-1273, merged 94e996d3) — `GET /api/outputs/:id/history` and the public
summary-only `GET /api/dashboards/:dashboardId/panels/:panelId/history?token=` — and render it. L5 does
NOT re-implement delta/baseline resolution.

Owner rulings binding here (HEL-918, 2026-10-05):
- D2 `compare` lives on `outputs.config.compare` (previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>).
- D3 Canonical metric is computed server-side over ALL rows (unfiltered). The metric headline ALSO switches
  to the server value (fixes today's first-200-rows error). With a viewer control filter active, the delta is
  hidden, with the tooltip "comparison reflects unfiltered data".
- D6 Baseline = nearest point at or before (latest captured_at − window). None → baseline null + availableFrom;
  the UI shows "7d comparison available from <date>". previous_run = second-newest point.
- D8 Public dashboards get the summary, never payloads.

Driver note (L3 delivery, HEL-1275 comment 2026-10-05): the API returns `value: null` for non-metric Outputs; L5
owns the per-kind delta presentation. After HEL-1272 thinning "previous" means the previous *surviving* point —
semantics still open in HEL-1285 — so no UI copy may promise "previous run".

## Scope

- MetricRenderer renders the trend (its existing unused data.trend slot) plus a sparkline, per DESIGN.md tokens.
- The PanelContent metric branch uses the server headline (D3).
- A compare selector in OutputKindFields.
- The provenance popover shows the "compared with" point time and value.
- The public panel path is covered too.
- With a viewer control filter active, the delta is hidden, with a tooltip.

## Acceptance Criteria

- RTL tests for ▲/▼/flat, the no-baseline "available from" message, and the delta hidden under a filter.
- A Playwright proof of the exit criterion: "1,204 ▲ 12% vs 7d" with a sparkline from seeded history.
- A light and dark visual check against the running app.

## Touches

frontend/src/features/panels/ui/renderers/MetricRenderer.tsx, PanelContent.tsx, a new history service/hook,
pipelines/ui/outputEditor/OutputKindFields.tsx, panels/provenance/ProvenanceContent.tsx.

## Run constraints (driver, 2026-10-05)

- Do not touch `.github/workflows/ci.yml` or `playwright.config.ts` (HEL-1287/HEL-1288 in flight).
- No migration without asking the driver (V116 is earmarked for L6).
- New e2e specs must not seed through the API while a post-login page is live on `/` (navigate to
  `about:blank` first — see e2e/hel1260-orphan-owner-repair.spec.ts, HEL-1289).
- Local Playwright ≤2 workers under `nice -n 19`; own ports and own headless browser context only.
- Deletion targets only by exact id/path/PID created and recorded by this run.
