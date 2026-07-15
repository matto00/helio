## Context

Below 768px, `App.css:335` fixes `.app-sidebar` and collapses it to `width: 0` with no reopen
affordance — section nav and the only dashboard switcher (`DashboardList` inside `SidebarBody`)
are unreachable. `notes/mobile-pwa-handoff.md` §W3 (binding) mandates a bottom tab bar plus a
tappable-title bottom sheet. HEL-300 ratified breakpoints in `DESIGN.md` §4: **1440/1100/768/430**
(430 = phone). Read `DESIGN.md` and `CONTRIBUTING.md` before writing code — both binding.

Current facts that constrain the design:

- Section nav: text-only `NavLink`s in `App.tsx` (`/` Dashboards, `/sources` Data Sources,
  `/pipelines` Data Pipelines, `/registry` Type Registry). No icons today; Lucide is already a
  dependency (`PanelLeftClose/Open` in `App.tsx`).
- Item nav: `SidebarBody` renders `DashboardList` on `/` and `SidebarItemList` elsewhere.
  `DashboardList` reads `state.dashboards` (`items`, `selectedDashboardId`, `status`, `error`) and
  dispatches selection; `SidebarItemList` covers sources/pipelines/types.
- Command bar: `.app-command-bar__breadcrumb` is `display: none` under the 768px media query.
- Overlay infra: `OverlayProvider`/`useOverlay` (single-active overlay + Escape), `Popover.css`,
  `Modal.css` (portal + backdrop patterns in `Modal.tsx`).

## Goals / Non-Goals

**Goals:** native-feeling phone navigation (W3.1–W3.3); every route escapable; desktop/iPad ≥768px
pixel-identical; `BottomNav` promotable to desktop via a breakpoint change only.

**Non-Goals:** panel sizing/grid work (HEL-301 owns `PanelGrid`, renderers, `PanelList` zoom —
do not touch those files); CRUD on phone; backend/`schemas/`; service-worker/manifest work.

## Decisions

1. **Gate the mobile shell at `max-width: 768px`, not 430px.** The broken sidebar stub occupies the
   whole <768 range today; gating the fix at 430 would leave 431–767px with zero navigation.
   768 is a canonical `DESIGN.md` §4 value, and handoff §2 defines "the phone" as <768px. The
   ≥768px requirement ("unchanged") is measured at 768 anyway. 430 remains available for
   phone-only density tweaks if needed. *Alternative rejected:* 430 gate (leaves a navless band).
2. **Single source of nav destinations.** New `shared/chrome/navDestinations.ts` exporting
   `{ to, end?, label, icon }[]` (Lucide icons, e.g. LayoutDashboard/Database/Workflow/BookOpen —
   final picks are the executor's, shown at the design checkpoint). Desktop sidebar `NavLink`s and
   `BottomNav` both map over it — phone and desktop cannot drift. *Alternative rejected:*
   duplicating the four links in `BottomNav` (drift risk the ticket explicitly warns about).
3. **`BottomNav` is presentational and breakpoint-gated by CSS** (`display: none` ≥768px; flex row
   below). Promotion to desktop is then literally a media-query/flag change. Rendered inside the
   app shell in `App.tsx`, always mounted. Opaque `--app-surface`, top hairline
   `--app-border-subtle`, active `--app-accent`, inactive `--app-text-muted`, labels in the UI face
   at `--text-xs`, height from control tokens + `env(safe-area-inset-bottom)` padding, each tab a
   ≥44×44 target. `aria-label="Primary"` `<nav>`, `NavLink` for active state.
4. **One sheet component, two data shapes.** New `shared/chrome/MobileNavSheet.tsx` (name final at
   executor's discretion) + CSS: a portal bottom sheet (follow `Modal.tsx`'s portal/backdrop
   pattern; register with `useOverlay` so Escape and single-active semantics hold). It receives a
   generic `items: { id, name, isActive }[]` + `onSelect`. Two thin container hooks/components feed
   it: dashboards from `state.dashboards` (same selectors as `DashboardList`; dispatch the same
   selection action `DashboardList` uses), and section items reusing the exact data
   `SidebarItemList` renders (sources/pipelines/types slices + their navigation semantics). No
   forked state, no second mechanism. *Alternative rejected:* reusing `Modal.tsx` directly (it is
   a centered dialog; a sheet needs bottom-anchored geometry, drag-to-dismiss, and no title bar).
5. **Tappable title in the command bar.** Below 768px the breadcrumb block stays hidden, but a new
   phone-only title button (dashboard name on `/`, current item or section name elsewhere) renders
   with a `ChevronDown`/`ChevronsUpDown` glyph so it reads as a control. It opens the sheet. On
   routes with nothing to pick (e.g. no items yet) it renders as a plain label or an empty-state
   sheet — no dead-end. Desktop DOM path is untouched (the button is `display: none` ≥768px).
6. **Sheet interactions:** backdrop tap, swipe-down (pointer-events-based drag on the sheet
   header/grabber — no new dependency), and Escape dismiss; selection dismisses. Opaque
   `--app-surface-strong`, `--app-radius-*` top corners, one entrance animation (translate-up,
   0.28s class of motion, `prefers-reduced-motion` respected) per `DESIGN.md` §3.
7. **Escapability:** `BottomNav` is rendered on all four protected routes below 768px, fixed to
   the bottom, above content (`z-index` above `.app-content`, below overlays). The old
   fixed-sidebar mobile block in `App.css` is replaced: below 768px the sidebar is simply
   `display: none` (not width-0 fixed), and `.app-content` gains bottom padding equal to the bar
   height + safe-area so content is never occluded.
8. **Human checkpoints (binding, from ticket + orchestrator):**
   - After first-cut visuals of BottomNav + sheet exist (component + CSS + wiring sufficient to
     screenshot), the executor STOPS, produces light+dark 390px screenshots of both, and returns
     them to the orchestrator for a human ESCALATION. Build-out completes only after feedback.
   - Terminal state is "ready for device testing": production build verified
     (`npm --prefix frontend run build`), plus an ordered on-device test plan (see tasks). Desktop
     Playwright evidence at 390px is regression/structure evidence only — never device proof.

## Risks / Trade-offs

- [768 gate widens visual blast radius vs 430] → it replaces an already-broken range; evaluator
  verifies ≥768px unchanged (screenshot diff at 768/1100/1440 vs main).
- [Parallel HEL-301 worktree also edits mobile CSS] → stay out of `PanelGrid`/renderers/`PanelList`;
  confine changes to shell files + new components to minimize merge overlap.
- [Swipe-down gesture quality unverifiable off-device] → keep gesture code tiny and standard
  (pointer events + translateY threshold); on-device test plan covers feel.
- [Sheet on non-dashboard routes depends on `SidebarItemList` internals] → reuse its data source,
  not its DOM; if its navigation semantics resist extraction, prefer a small shared hook over
  duplication.

## Planner Notes (self-approved decisions)

- Breakpoint gate = 768px (Decision 1) — canonical value, fixes the whole broken range.
- Icon choices are first-cut and explicitly subject to the human design checkpoint.
- No new dependencies (no gesture/sheet library) — pointer events suffice at this scope.
