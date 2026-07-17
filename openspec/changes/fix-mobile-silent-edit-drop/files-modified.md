# Files modified — fix-mobile-silent-edit-drop (HEL-304)

## Source

- `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts` — **new.** Width-independent
  pending-panel-updates flush lifecycle hoisted out of the former `usePanelGridSave`: 30s auto-save
  interval, dashboard-switch flush + `resetPanelSaveState`, Save-now registration
  (`SaveStateContext`), imperative `flushAndReset` handle, and a layout-flush *slot* ref that
  `flushAll` invokes only when populated. Mounted by `PanelGrid` at every container width.
- `frontend/src/features/panels/hooks/useLayoutSave.ts` — **new.** The layout half of the former
  `usePanelGridSave` (latest/persisted/in-flight layout refs, `markLayoutChanged`, `persistLayout`,
  the `setLayoutPending` transition). Called only by `DesktopPanelGrid`; registers `persistLayout`
  into the parent flush slot on mount and clears it on unmount, so no layout-write path survives the
  shell swap below the `sm` boundary.
- `frontend/src/features/panels/hooks/usePanelGridSave.ts` — **deleted.** Split into the two hooks
  above; it was the single owner that only mounted inside `DesktopPanelGrid` (the root cause).
- `frontend/src/features/panels/ui/PanelGrid.tsx` — mounts `usePanelUpdatesFlush` (both branches),
  forwards `registerLayoutFlush` to `DesktopPanelGrid`, exposes the flush handle at every width, and
  updates the hazard §4.1 class doc to describe the split.
- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx` — swapped `usePanelGridSave` →
  `useLayoutSave`; dropped the now-unneeded `forwardRef`/`DesktopPanelGridHandle`; added the
  `registerLayoutFlush` prop; refreshed the hazard §4.1 header comment.
- `frontend/src/features/panels/ui/MobilePanelStack.tsx` — updated the hazard §4.1 comment (now
  references `useLayoutSave`) and documented that panel title/appearance edits made here DO persist via
  the hoisted flush, issuing only panel-batch writes, never a layout PATCH.
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` — rewrote the obsolete HEL-301 "does not
  register a save-flush handle" test and added the HEL-304 regression suite (phone-width flush,
  Save-now at phone width, resize-mid-edit strand, pure-resize zero-layout-PATCH guard).

## Planning artifacts

- `openspec/changes/fix-mobile-silent-edit-drop/tasks.md` — all tasks marked complete + Decision 3
  resolution notes.

---

## Root-cause probe evidence (systematic-debugging Iron Law)

**Root cause (layer: UI/state ownership).** The pending-panel-updates flush lifecycle (30s interval,
Save-now `registerFlush`, imperative handle) lived only inside `usePanelGridSave`, which mounted only
inside `DesktopPanelGrid` (container width ≥ 768px). The producer (`PanelDetailModal` →
`accumulatePanelUpdate` → `pendingPanelUpdates`) and the Redux state are width-independent, so below
768px nothing ever flushed.

**Probe.** Four assertions added to `PanelGrid.test.tsx`, run against the **unfixed** code
(`npx jest --testPathPatterns "PanelGrid.test"`):

**Probe output (before fix — all four FAIL, confirming the cause predicts the symptom):**

- `exposes a live flush handle at phone width …` → `updatePanelsBatch` calls: **Expected 1, Received 0`.
- `flushes an appearance edit staged at phone width on the auto-save tick` → `updatePanelsBatch` calls:
  **Expected 1, Received 0** after advancing 30s (no interval exists at phone width → silent drop).
- `wires a functional Save-now at phone width …` → the registered flush handler is **`null`**
  (`registerFlush` was never called at phone width → Save-now is a dead button).
- `does not strand updates staged at desktop when the width drops below 768px` → `updatePanelsBatch`
  calls: **Expected 1, Received 0** (desktop grid unmounts on resize, interval cleared, pending
  stranded).

Summary line before fix: `Tests: 4 failed, 17 passed, 21 total`.

**After fix:** `Tests: 21 passed, 21 total`; full suite `Tests: 1096 passed`.

**Decision 3 probe (layout mid-edit resize).** The test `issues zero layout PATCH on a pure resize
across the 768px boundary (no drag)` **passes before and after** — a pure resize never PATCHes layout.
The desktop-drag-then-resize-below-768px-within-30s case DOES drop the staged layout today; per remedy
(a) ("layout persistence stays structurally desktop-only") and the sacred HEL-301 guard, no unmount
layout flush was added (see audit note row 4).

---

## PR audit note — every `usePanelGridSave`-dependent mutation path checked (AC #3)

Probed at phone width (≈390×844 modelled at container width 375), tablet width (≥768 stays desktop),
and a desktop window resized below 768px mid-edit. All findings backed by the probe evidence above or
by code-flow tracing.

| # | Path | Mechanism | Behavior at <768px BEFORE | AFTER fix |
|---|------|-----------|---------------------------|-----------|
| 1 | Appearance (+title) via `PanelDetailModal` Save — all kinds incl. collection | `accumulatePanelUpdate` → batch flush | staged, **NEVER flushed → silent drop** (probe: 0 batch calls) | flushes via interval / Save-now / dashboard switch (probe: 1 batch call, pending cleared) |
| 2 | Inline title edit on grid card | `accumulatePanelUpdate` (desktop only) | unreachable <768px; **stranded on mid-edit resize** (probe: 0 batch calls) | strand fixed by hoisted flush (probe: 1 batch call) |
| 3 | "Save now" button | `registerFlush` via `SaveStateContext` | visible but **dead** (handler `null` at phone width) | functional at all widths (probe: registered + 1 batch call; no-op when clean) |
| 4 | Layout drag/resize PATCH | `updateDashboardLayout` (desktop `useLayoutSave` only) | unreachable <768px (HEL-301) | **unchanged.** Pure resize across 768px = 0 layout PATCH (probe passes). Desktop-drag-then-resize-below-768px-in-30s still drops the staged layout — pre-existing, out of AC #1 scope, no unmount flush added to keep layout structurally desktop-only + protect xs byte-identity |
| 5 | Table column widths | `updatePanelColumnWidths` thunk, immediate PATCH (`TableRenderer`) | persists (immediate, independent of flush); column-resize handles are a desktop table interaction | unchanged |
| 6 | Subtype editors: binding / markdown / text / image / divider / **collection** | typed thunks (`updatePanelCollection`, etc.) awaited in modal submit — immediate PATCH | persist immediately regardless of width | unchanged |
| 7 | Panel delete / duplicate / create; dashboard appearance; undo/redo | immediate thunks; affordances desktop-only or CSS-hidden ≤768px | unreachable or immediate | unchanged |
| 8 | Mobile browsing (stack scroll, dashboard switch, detail view, width change) | — | zero layout PATCH (HEL-301) | **re-asserted:** xs byte-identity; the hoisted flush issues only panel-batch writes at phone width, never a layout PATCH (probe assertions confirm `updateDashboardLayout` not called) |

**HEL-301 guard status:** preserved and re-tested. `updateDashboardLayout` / `setLayoutPending` remain
reachable only from `useLayoutSave` inside `DesktopPanelGrid`; at phone width the layout-flush slot is
empty, so `flushAll` cannot issue a layout PATCH.
