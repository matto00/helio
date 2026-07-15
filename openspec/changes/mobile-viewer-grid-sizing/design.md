## Context

`notes/mobile-pwa-handoff.md` is the binding spec (sections W4, W5, hazard §4.1); read it in full, plus
`DESIGN.md` and `CONTRIBUTING.md`, before writing code. Current state on `main` (post HEL-300, PR #226):

- `PanelGrid.tsx` renders RGL `<Responsive>` with `panelGridConfig.breakpoints = {lg:1440, md:1100, sm:768,
  xs:0}` over **container width** (`useContainerWidth`), `rowHeight: 52`, `margin: [18,18]`. Every breakpoint,
  including `xs`, feeds `onLayoutChange` → `markLayoutChanged` (`usePanelGridSave.ts`) → 30s-interval
  `persistLayout` → `PATCH /api/dashboards/:id`. `xs` is a real stored layout (`dashboardGridCols.xs = 2`).
- `usePanelGridSave` suppresses no-op PATCHes via `areDashboardLayoutsEqual(latest, persistedLayoutRef)` —
  but RGL re-derives item geometry at `xs` on mount/width change, so the resolved layout can legitimately
  differ from stored and the PATCH fires. The suppression is an accident of equality, not a guarantee.
- The 430px phone breakpoint is ratified in `DESIGN.md` §4 (HEL-300); container queries exist on `panel-card`
  (`panel-container-queries` spec). `PanelList.tsx` renders the zoom widget; `PanelDetailModal.css` already
  uses the ratified breakpoint for its phone query.

## Goals / Non-Goals

**Goals:** structural impossibility of layout write-back below the `sm` grid boundary; native-feeling
per-kind panel heights; phone density/chrome; renderer correctness at ~390px; desktop/iPad ≥768px unchanged;
hand back "ready for device testing" with a build + ordered test plan.

**Non-Goals:** navigation (HEL-302), PWA shell (HEL-300), any phone editing, backend/`schemas/` changes,
changing `dashboardGridCols` or the persisted layout contract, offline data.

## Decisions

### D1 — Stack gates on grid container width < 768 (`panelGridConfig.breakpoints.sm`), not a 430px media query

The corruption hazard is keyed to RGL's breakpoint resolution, which runs on **container width**. Gating the
stack on the same width RGL uses guarantees `<Responsive>` never mounts in the regime where it would resolve
the `xs` layout — closing the hazard exactly at its boundary. A 430px viewport query would leave a 430–768px
container window where RGL still mounts at `xs` and can PATCH. This also matches the handoff's own framing
("the phone (<768px) is a viewer", §2; "below 768px the grid must be structurally incapable of persisting
layout", §4.1). The ratified 430px breakpoint remains the gate for *CSS density/chrome* (D4). Alternative
rejected: keeping `<Responsive>` mounted with a no-op `onLayoutChange` — "drag disabled" is exactly what
§4.1 forbids; the only guarantee worth having is the absent code path.

### D2 — New `MobilePanelStack` component; `PanelGrid` branches before any RGL/save wiring

New `frontend/src/features/panels/ui/MobilePanelStack.tsx` + `.css`: a plain flex column of `PanelCard`s
sorted by the stored-or-resolved `xs` layout (`y` asc, then `x` asc), read-only (no drag handle, no title
edit, no delete; tap opens `PanelDetailModal`). The branch lives in `PanelGrid` after `useContainerWidth`
(hooks must run unconditionally — `usePanelGridSave` may still be *called* on the phone path, but the stack
never invokes `markLayoutChanged`; prefer restructuring so the save hook's owner component simply doesn't
render the wiring, e.g. split the RGL grid into an inner component mounted only ≥768). Whichever structure
the executor picks, the invariant to test is: **no dispatch of `updateDashboardLayout` and no
`setLayoutPending` can originate from the stack path** — assert via a Jest test that renders the grid at
phone width and verifies no PATCH-bound action fires on mount, width change, or the 30s flush tick
(advance fake timers past `AUTO_SAVE_INTERVAL_MS`).

### D3 — Per-kind heights implemented as data, not scattered CSS

A pure helper (e.g. `mobilePanelHeights.ts`, unit-testable) maps `(kind, h, w)` → height policy per handoff
W4.3: metric ~104–132px ignoring `h`; chart `clamp(200px, w×0.62, 340px)` with `h≤4` → compact end / `h≥8` →
tall end; table `min(60dvh, intrinsic)` with internal scroll (the only nested scroller); text/markdown/image
intrinsic; divider bare hairline without card chrome. Numbers are **starting points to be tuned on device**
— centralizing them in one module makes the expected iteration a one-file change. CSS applies the policy via
custom properties on the stack item, tokens only per `DESIGN.md` §3.

### D4 — Chrome/density via the ratified 430px breakpoint + existing container queries

Gutters/container padding → `--space-3` rhythm; hide footer type badge; hide the zoom widget in
`PanelList.tsx` below 430; metric typography from the `DESIGN.md` type scale with tabular numerals. Prefer
the existing `panel-card` container queries for panel-internal density; use the 430px media query only for
page-level chrome (zoom widget, modal full-screen). No new breakpoint values (DESIGN.md §4 is exhaustive).

### D5 — Renderers: config over CSS for ECharts; DataGrid owns horizontal scroll

ChartRenderer: explicit `resize()` on container change (verify the existing ResizeObserver path covers
rotation); legend/axis overflow fixed via ECharts options (consider hiding legends below phone width via the
container width already known to the renderer). TableRenderer/`DataGrid.css`: `overflow-x: auto` on the
panel-internal scroller; body must never scroll sideways (guard with `overflow-x` audit at stack level).
Markdown/text: `overflow-wrap`/`pre` handling so long words and code blocks wrap or scroll within content
width. Image: `max-width: 100%; height: auto`.

## Risks / Trade-offs

- [Desktop regression: users who resized a window under 768px container width previously could edit the `xs`
  layout; they now get the read-only stack] → Intended per handoff §2 (<768 is a viewer). ≥768 must be
  pixel-identical; the evaluator checks desktop at standard widths.
- [Height numbers wrong on real device] → Expected; D3 centralizes them. Terminal state is device testing.
- [ECharts rotation resize unverifiable off-device] → Implement the resize wiring, verify what a desktop
  resize can show, list rotation explicitly in the device test plan.
- [Nested-scroll regressions] → Only `table` may own a scroller; Jest/DOM assertions plus evaluator check
  that stack items have no `overflow` besides the table case.
- [Parallel HEL-302 touches nav in another worktree] → Do not touch `App.tsx` nav, `App.css` sidebar rules,
  or anything HEL-302 owns; keep the diff inside the panels/dashboards feature surface listed in Impact.

## Planner Notes (self-approved decisions)

- Resolved ticket-vs-handoff ambiguity ("below the phone breakpoint" vs "below 768px") as D1: structural
  stack at container `sm` boundary; 430px for CSS chrome. Grounded in handoff §2/§4.1 and the RGL container-
  width mechanism; no API/dependency/architecture impact, so self-approved.
- Verification stance: evaluator/skeptic must treat desktop-viewport evidence as *implementation* evidence
  only; acceptance criteria tied to a physical device stay open in the handback plan. The deliverable
  includes `npm --prefix frontend run build && npx vite preview --host` instructions and the ordered §6
  device checklist (layout-corruption byte-identity check first, then one-of-every-kind sizing check).
