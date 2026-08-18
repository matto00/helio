### Frontend

- [x] 1.1 Swap Assistant sidebar icon in `frontend/src/shared/chrome/sections.ts:103` from
  `MessageSquare` to `MessageCircle` (import + usage).
- [x] 1.2 Swap Metrics sidebar icon in `frontend/src/shared/chrome/sections.ts` from `Gauge` to
  `ChartNoAxesColumn` (import + usage).
- [x] 1.3 Restyle the "Customize dashboard" trigger in
  `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` (lines ~271-280) onto the
  shared `cmd-btn cmd-btn--icon` recipe: drop `popover__trigger dashboard-appearance-editor__trigger`,
  add a `faSliders` icon, **remove the visible `<span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>`
  text span entirely** (icon-only content, matching its `cmd-btn cmd-btn--icon` siblings in
  `CommandBar.tsx` — `.cmd-btn--icon` is a fixed 28×28px, `padding: 0` recipe with no room for
  icon + text), preserve `aria-label="Customize dashboard appearance"`, add a `title` tooltip.
- [x] 1.4 Remove the now-redundant `dashboard-appearance-editor__trigger` CSS override (padded pill
  radius) **and** the now-orphaned `.dashboard-appearance-editor__trigger-copy` rule from
  `DashboardAppearanceEditor.css` once the trigger is a real icon-only `cmd-btn`.
- [x] 1.5 Swap "Refine with AI" icon in `frontend/src/app/CommandBar.tsx:208-218` from
  `faCommentDots` to `faWandMagicSparkles`.

### Tests

- [x] 2.1 Run/update existing component tests covering `Sidebar`, `BottomNav`,
  `DashboardAppearanceEditor`, and `CommandBar` to confirm no aria-label, click-handler, or
  snapshot regressions from the icon/class swaps.
- [ ] 2.2 Visual/UI review (evaluator phase): confirm the four icons render distinctly at both
  full and collapsed sidebar widths, in light and dark theme, and that the restyled
  "Customize dashboard" trigger visually matches its `cmd-btn cmd-btn--icon` neighbors with no
  residual pill-shaped styling.
