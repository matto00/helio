# HEL-248 — Per-chart-type config — line / bar / pie / scatter

**Status:** In Progress · **Priority:** Medium · **Project:** Helio v1.5 — Panel System v2 · **Parent:** HEL-239

## Description

Today a Chart panel exposes a uniform config surface regardless of chart type. Each chart type has meaningfully different config needs. Surface type-appropriate options.

## Per-type config (brainstormed; refine during planning — NOT binding)

- **Line**: series (multi), x-axis field, smoothing on/off, point markers on/off, area fill on/off
- **Bar**: orientation (vertical/horizontal), stacking (none/stacked/normalized), group spacing
- **Pie**: slice field, value field, donut hole size, show percentages on/off
- **Scatter**: x field, y field, size field (optional), color field (optional)

## Acceptance criteria

- Changing chart type swaps in the appropriate config section
- Each section's controls map cleanly to ECharts options (no fake controls)
- Existing chart panels keep working without manual migration

## Definition of done

- Type-specific config UI for all four chart types
- Documentation / inline hints for less obvious options
- Tests assert that switching chart type doesn't lose unrelated config (e.g. appearance, refresh interval)

## Session directives (user-supplied, binding)

- **Persistence convention:** follow the typed-config-column precedent (HEL-253/V55; HEL-255 / PR #231 added `density`/`columnOrder` to TablePanelConfig this way). Pattern for extending panel config storage end-to-end: TS type + `panel.schema.json` + domain Scala + `RequestValidation` + `PanelRowMapper` + `configColumnsOf` write path + Flyway migration; absent field = current behavior.
- **KNOWN PITFALL:** spray-json omits `Option=None` on the wire — normalize at the service boundary, test with fields ABSENT, and scrutinize `PanelRowMapper`'s chart arm (two sibling bugs caught in HEL-245/255).
- Every control must map to a real ECharts option (no fake controls).
- Switching chart type must not lose unrelated config (appearance, refresh interval, binding).
- **Style/UX bar:** strictly honor DESIGN.md (tokens, spacing/type scales, canonical breakpoints 1440/1100/768/430, shared components). Chart config editor should speak the Epic A config language (`BoundOrLiteralField` family in `frontend/src/features/panels/ui/editors/`).
- **Mobile is a first-class verification target** (shell activates <768px, verify at ~390×844):
  - All four chart types render legibly in MobilePanelStack with type-specific config applied (axes/labels/legends not clipped).
  - New config controls meet ≥44px touch targets at mobile width — extend the HEL-245/255 `@media (max-width: 768px)` pattern in `PanelDetailModal.css` and its CSS-lock test.
  - No horizontal overflow.
- Clean up trivial style debt in files already being edited.
- `BindingEditor.tsx` sits at the 400-line CONTRIBUTING.md split threshold; if chart-type config pushes it past, split it rather than growing it.

## Operational hygiene (binding)

- Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root.
- Never bulk-delete by glob; delete only files you created, by exact name.
- HEL-255 cleanup may run in parallel — stay inside this worktree and ports (dev 5421, backend 8328).
- If pre-commit fails ONLY on `check:openspec-hygiene` (change complete but not archived), a `-n` bypass with all real gates verified out-of-band is accepted — call it out; archive happens during delivery.
