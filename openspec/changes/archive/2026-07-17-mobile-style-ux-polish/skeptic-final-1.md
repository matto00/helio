## Skeptic Report — final gate (round 1)

Cold verification of commit `b109b7a0` (HEL-303, task/mobile-style-ux-polish/HEL-303). All
evidence below was gathered fresh in this session (gates re-run, live browser at 390×844, both
themes, `getBoundingClientRect`/network-capture measurements) — the evaluator's PASS
(evaluation-1.md, evaluation-2.md) was treated as a claim to verify, not fact.

### What I verified (with evidence)

**Gates (fresh re-run, this session):**
- `npm run lint` — clean, 0 warnings.
- `npm run format:check` — clean.
- `npm test` — 103 suites / 1108 tests passed.
- `git diff main...HEAD --stat` — diff is exactly 3 CSS files + 3 test files + openspec artifacts;
  no `mobilePanelHeights.ts` change (confirmed via `git diff main...HEAD -- .../mobilePanelHeights.ts`
  returning empty), matching the "no constant tuning needed" claim.

**AC1 — MobileNavSheet rows ≥44px.** Independently measured via `getBoundingClientRect` at
390×844, both themes, all four routes (opened each sheet fresh, not reusing evaluator's session):
- `/` dashboard sheet: 18 rows, min/max 44.0px (light and dark).
- `/sources`: 21 rows, 44.0px (light and dark).
- `/pipelines`: 9 rows, 44.0px (light and dark).
- `/registry`: 38 rows, 44.0px (light and dark). Screenshot
  `.playwright-mcp/skeptic-registry-sheet-dark.png` confirms visual polish/token parity (dark bg,
  orange accent row, comfortable spacing).

**AC2 — Edit-affordance honesty.** On "Bar Chart Sweep" and "Pie Sweep Test" panels (two chart
types, per the brief), both themes:
- Header Edit 47.4×44px, Close 44×44px (light); identical in dark.
- Footer Cancel 79.8×44px, Save 66.1×44px (both themes).
- Chart Display checkbox rows (`.panel-detail-modal__chart-label`): all 5 rows ("Series colors",
  "Show legend", "Enable tooltip", "Show X-axis label", "Show Y-axis label") measured exactly 44px
  on both Bar and Pie panels, both themes.
- Series-color swatches (`input[type="color"]`): all 8 swatches 44×44px on both chart types, both
  themes; screenshots (`skeptic-chart-edit-light.png`, `skeptic-chart-edit-dark.png`) confirm
  clean 6+2 wrap with no crowding/overlap in either theme.
- Pre-existing HEL-248 `.panel-detail-modal__toggle-row` controls ("Smooth lines"/"Point
  markers"/"Area fill") spot-checked at 44px — unaffected, confirms no regression from this diff.
- **Independently reproduced end-to-end persistence** (not just re-trusting the evaluator's claim):
  opened Bar Chart Sweep → Edit → toggled "Show legend" off → Save → full page reload → reopened
  Edit → checkbox still unchecked. Network capture across the whole save/reload cycle showed the
  save request as `POST /api/panels/updateBatch` (200) and **zero** `PATCH /api/dashboards/:id`
  at any point (verified via `browser_network_requests`, both filtered and full unfiltered log).
  Restored the checkbox to its original state afterward.
- No drag/resize/layout-editing affordance found in the stack: `[class*="drag"]`,
  `.react-resizable-handle`, `[class*="grabber"]` all return 0 elements; the only `[class*="resize"]`
  matches are `.ui-data-grid__resize-handle` (Table panel's own column-resize handles — a
  content-level feature of the table, not panel-grid layout drag/resize, and untouched by this diff).

**AC3 — Panel-kind sweep, incl. collection with REAL multi-row data.** All 11 kinds/instances in
the "HEL-303 Panel Kind Sweep" stack measured via `scrollWidth`/`clientWidth`/`getBoundingClientRect`
at 390×844, both themes: metric, chart×5, table, collection×2, image, markdown, text — zero
horizontal overflow anywhere (`document.documentElement.scrollWidth === window.innerWidth === 390`
throughout). Screenshots of the full stack scroll in both themes (`skeptic-stack-dark-top/mid/mid2/bottom.png`,
`skeptic-stack-light-top.png`) show no clipping, correct image aspect ratio, correct table internal
scroll (expected/pre-existing for Table, not "no internal scroller" territory).
- **Collection fix, independently verified with fresh REAL multi-row data** (the existing
  "Metric Collection Edited E1" fixture panel on this dashboard had lost its bound data — see
  non-blocking note below — so I did not rely on it). I created a new Collection panel bound to
  `HEL254WideType` (a real, persisted 200-row pipeline output) via the actual Add-panel flow. Result:
  `panel-content--collection` rendered 50 real items, `scrollHeight === clientHeight` (3266px, no
  internal scroll needed), computed `overflow: visible`, `container-type: inline-size` (not `size`),
  and zero document-level horizontal overflow — this is a stronger, more thorough reproduction than
  the evaluator's 5-item check and confirms the collapse fix holds under real data, not just a small
  fixture. Grid computed a single 257px column at this content width (auto-fill `minmax(140px,1fr)`
  correctly not fitting 2 columns at ~281px content width) — matches the evaluator's independent
  observation exactly, and is correct wrapping behavior, not a defect.

**AC4 — Token compliance.** Read `openspec/changes/mobile-style-ux-polish/design.md` Decision 5:
`44px` is an explicitly sanctioned literal (matches `BottomNav.css`/`PanelDetailModal.css`
convention). Diff review (`git diff main...HEAD` on the three CSS files) confirms: only
`min-height`/`min-width: 44px` added, all inside the existing canonical `@media (max-width: 768px)`
block, no new hex/rgb colors, no non-canonical breakpoints. Pre-existing `PanelDetailModal.css`
spacing debt (untouched rules) correctly excluded from this ticket's scope per its own framing.

**AC5 — Layout byte-identity.** Zero `PATCH /api/dashboards/:id` observed across my entire session:
route navigation across all 4 routes, theme toggling, panel creation, panel edits (chart config
edit + save + reload), modal open/close cycles. Confirmed via both filtered and full
`browser_network_requests` dumps.

**Spec deltas honest against implementation.** Read
`specs/mobile-dashboard-sheet/spec.md` and `specs/mobile-viewer-stack/spec.md` — both scenarios
match exactly what the diff implements and what I measured live (44px sheet rows; reachable edit
paths complete end-to-end at 44px; no drag/resize implied).

**Breakpoint regression spot-check.** 1440px: desktop grid renders normally
(`skeptic-1440-light.png`), unaffected by the stack-scoped CSS (selectors are scoped to
`.mobile-panel-stack__item--*`, which doesn't exist in the desktop `PanelGrid` DOM). 768px: mobile
stack still active (canonical breakpoint boundary), collection grid wraps to 4 columns at the wider
content width — expected, not a regression.

**Console.** 0 errors across the entire session (`browser_console_messages`, level=error, all=true).

### Verdict: CONFIRM

### Non-blocking notes

- Several fixture panels on the shared "HEL-303 Panel Kind Sweep" dev dashboard show "No data
  available" (Pie Sweep Test, all 3 Bar Chart Sweep instances, Metric Collection Edited E1,
  Markdown Document, Description Block, KPI Metric) — their underlying pipelines are absent from
  the current `/pipelines` listing entirely, unlike the still-working Time-series Line Chart/Full
  Data Grid/Image Display panels. This is a **pre-existing data/environment artifact** (unrelated to
  this CSS-only diff — confirmed by `git diff` showing no backend/data changes), likely from
  DemoData re-seeding on a backend restart wiping prior sessions' manually-created pipeline runs
  while leaving the dashboard/panel fixtures themselves intact. It cost verification time this round
  (had to build a fresh real-data Collection panel independently rather than reuse the existing
  fixture) but does not block this ticket. Worth a note to the team: dashboards used as
  cross-session verification fixtures should either bind to DemoData-seeded (restart-durable)
  pipelines, or the fixture-refresh cost should be budgeted into future rounds.
- I added one new panel ("Skeptic Collection Real Data", bound to `HEL254WideType`) to the shared
  dashboard during verification, left in place (matches existing convention on this dashboard, which
  already carries several previous cycles' unremoved verification panels/dashboards).
- Carrying forward the two spinoff candidates already flagged by the executor/evaluator
  (PanelDetailModal.css token/spacing debt + file-split proposal; pre-existing stale-form-state bug)
  — both correctly out of this style-only ticket's scope, confirmed still applicable and not
  reintroduced or worsened by this diff.
