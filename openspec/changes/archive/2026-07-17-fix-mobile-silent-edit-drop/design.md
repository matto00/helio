# Design — fix-mobile-silent-edit-drop (HEL-304)

## Context

`pendingPanelUpdates` (Redux, `panelsSlice`) accumulates panel title/appearance edits from producers that mount at
ANY width: `PanelDetailModal` is rendered by both `DesktopPanelGrid` and `MobilePanelStack`. The only flusher —
`usePanelGridSave` (30s interval, dashboard-switch flush, `registerFlush` for Save-now, imperative handle) — mounts
only inside `DesktopPanelGrid` (≥768px container width, `panelGridConfig.breakpoints.sm`). Consequences (static
analysis; executor MUST re-confirm live per `.concertino/laws/systematic-debugging` before implementing):

1. Appearance/title edits saved in the detail modal at <768px stage into Redux and never PATCH (the literal repro).
2. `SaveStateIndicator` is visible at ≤768px (App.css hides breadcrumb/undo-redo/sidebar, not the indicator);
   it shows "Unsaved changes" but `flush` is a no-op — `registerFlush` was never called (`App.tsx` `flushFnRef`).
3. Edits staged at desktop width strand when the window crosses below 768px mid-edit: `DesktopPanelGrid` unmounts,
   the interval is cleared, pending updates survive in Redux with no owner.
4. The HEL-301 structural guarantee (no layout write path below `sm`; xs byte-identity) lives in the same hook and
   must not be weakened.

## Goals / Non-Goals

- Goals: every staged panel-field edit persists at any viewport width (remedy (a)); Save-now works at all widths;
  resize-mid-edit never strands data; HEL-301 layout guarantee preserved and re-tested; regression tests + audit.
- Non-Goals: removing mobile edit affordances or styling polish (HEL-303); changing subtype-editor typed thunks,
  batch API, or backend; changing layout persistence semantics.

## Decisions

1. **Remedy (a) over (b).** (b) alone cannot fix consequence 3 (desktop strand), so a width-independent flush owner
   is required either way; (b)'s affordance removal is HEL-303's AC (scope). Subtype editors already persist
   immediately on mobile, so the shell is not read-only in practice today. (a) also gives defense in depth after
   HEL-303 hides affordances.
2. **Split `usePanelGridSave` into two hooks.**
   - `usePanelUpdatesFlush` (new; called from `PanelGrid`, so mounted at every width whenever a dashboard renders):
     owns the pending-updates interval, `flushPanelUpdates`, dashboard-switch flush + `resetPanelSaveState`,
     `registerFlush` (Save-now), and the imperative flush handle. `flushAll` also invokes an optional layout-flush
     slot (a ref) when populated.
   - Layout half (rename e.g. `useLayoutSave`; still called ONLY from `DesktopPanelGrid`): `latestLayoutRef`,
     `persistedLayoutRef`/`inFlightLayoutRef`, `markLayoutChanged`, `persistLayout`. On mount it registers
     `persistLayout` into the parent's layout-flush slot; on unmount it unregisters. `updateDashboardLayout` /
     `setLayoutPending` dispatches remain confined to this hook/file — preserving the hazard §4.1 comment contract
     in `PanelGrid.tsx` / `DesktopPanelGrid.tsx` / `MobilePanelStack.tsx` (update those comments to match).
   - Alternative considered: flush-on-unmount inside `DesktopPanelGrid` only — rejected: leaves the phone-width
     modal path (consequence 1) unfixed and Save-now dead on mobile.
3. **Layout mid-edit resize (probe first, then decide).** Executor probes: drag a panel at desktop, resize below
   768px within 30s. If the staged layout is dropped (expected), add a guarded unmount flush in `useLayoutSave`
   (`persistLayout()` in the effect cleanup — it already no-ops on `areDashboardLayoutsEqual` vs persisted /
   in-flight). Guard REQUIRED: a pure resize crossing the boundary with no user drag must issue ZERO layout PATCH
   (regression test). If probes show RGL mutates layouts during downward resize (equality guard insufficient),
   do NOT unmount-flush; document the pre-existing 30s-window layout edge in the PR instead. Never PATCH layout
   from any code path reachable while the stack is mounted.
4. **Keep `PanelGridHandle` surface.** No external consumers exist (grep-verified); the handle now proxies the
   width-independent flush, populated in both branches. Update the misleading "no-op below sm" doc comments.

## Mutation-path audit (every `usePanelGridSave`-dependent path; evaluator/skeptic re-probe at ~390×844, tablet
~760px, and desktop resized <768px mid-edit)

| # | Path | Mechanism | Today at <768px | After fix |
|---|------|-----------|-----------------|-----------|
| 1 | Appearance (+title) via PanelDetailModal Save (all kinds incl. collection) | `accumulatePanelUpdate` → batch flush | staged, NEVER flushed → silent drop | flushes (interval / Save-now / dashboard switch) |
| 2 | Inline title edit on grid card | `accumulatePanelUpdate` (DesktopPanelGrid) | unreachable below sm; strands on mid-edit resize | strand fixed by hoisted flush |
| 3 | "Save now" button | `registerFlush` via SaveStateContext | visible but dead (nothing registered) | flushes at all widths |
| 4 | Layout drag/resize PATCH | `updateDashboardLayout` (desktop hook only) | unreachable below sm (HEL-301) | unchanged; mid-edit resize per Decision 3 |
| 5 | Table column widths | `updatePanelColumnWidths` thunk, immediate | persists (verify reachability in modal/stack) | unchanged |
| 6 | Subtype editors: binding/markdown/text/image/divider/collection | typed thunks, immediate PATCH | persist | unchanged |
| 7 | Panel delete/duplicate/create; dashboard appearance; undo/redo | immediate thunks; affordances desktop-only / CSS-hidden ≤768px | unreachable or immediate | unchanged |
| 8 | Mobile browsing (stack scroll, dashboard switch, detail view) | — | zero layout PATCH (HEL-301) | re-asserted: xs byte-identity |

## Risks / Trade-offs

- [Hoisted interval runs at phone width] → it only dispatches when pending is non-empty; identical desktop code.
- [Unmount layout flush could PATCH an RGL-reflowed layout] → equality guard + pure-resize zero-PATCH test; fall
  back to no-unmount-flush per Decision 3.
- [HEL-301 test `does not register a save-flush handle` (PanelGrid.test.tsx:462) now obsolete] → rewrite it: the
  handle exists at phone width, flushes panel batches, and still never dispatches a layout PATCH.
- [Modal Save at phone gives no immediate PATCH (30s window)] → same as desktop semantics; beforeunload guard and
  Save-now (now functional) cover it.

## Migration Plan

Frontend-only refactor + tests; no API/schema/data changes. Rollback = revert commit.

## Planner Notes (self-approved)

- Remedy (a) chosen with evidence (Decision 1) — no new deps, no API change, no scope beyond ticket → no escalation.
- Elevated style bar applies: DESIGN.md tokens; canonical breakpoints 1440/1100/768/430; fix trivial style debt only
  in files already edited. Playwright screenshots → session scratchpad/gitignored tmp, never repo root.
- Worktree dev ports: dev 5477 / backend 8384 (authoritative; do not recompute).
