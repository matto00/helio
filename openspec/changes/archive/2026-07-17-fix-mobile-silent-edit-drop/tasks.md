# Tasks — fix-mobile-silent-edit-drop (HEL-304)

## 1. Root-cause probes (Iron Law: systematic-debugging — BEFORE any fix)

### Frontend

- [x] 1.1 Live-reproduce the literal bug: appearance edit via detail modal at ~390×844 → confirm no PATCH fires, `pendingPanelUpdates` populated, "Save now" no-op (network log evidence)
- [x] 1.2 Probe resize-mid-edit strand: stage appearance/title edit at desktop width, resize window below 768px within 30s → confirm pending updates stranded (no flush ever)
- [x] 1.3 Probe layout mid-edit resize (design Decision 3): drag a panel at desktop, resize below 768px within 30s → record whether the staged layout is dropped; record whether a pure resize (no drag) across the boundary fires any layout PATCH
- [x] 1.4 Probe remaining audit rows (design table #5–#8) at phone width: column widths, subtype editors incl. collection, delete/duplicate reachability, mobile browsing zero-layout-PATCH

## 2. Implementation

### Frontend

- [x] 2.1 Split `usePanelGridSave`: extract width-independent `usePanelUpdatesFlush` (interval, `flushPanelUpdates`, dashboard-switch flush + `resetPanelSaveState`, `registerFlush`, imperative handle, layout-flush slot ref)
- [x] 2.2 Reduce the desktop-only remainder to a layout hook (`useLayoutSave`): layout refs, `markLayoutChanged`, `persistLayout`; register/unregister `persistLayout` into the parent slot on mount/unmount; keep `updateDashboardLayout`/`setLayoutPending` confined to this hook
- [x] 2.3 Mount `usePanelUpdatesFlush` in `PanelGrid` (both branches); wire `PanelGridHandle`/`DesktopPanelGridHandle` and `SaveStateContext` registration through it
- [x] 2.4 Per 1.3 evidence: if layout mid-edit drop confirmed AND equality guard sound, add guarded unmount `persistLayout()` in `useLayoutSave`; otherwise document the edge in the PR (design Decision 3 fallback)
- [x] 2.5 Update the hazard §4.1 doc comments in `PanelGrid.tsx`, `DesktopPanelGrid.tsx`, `MobilePanelStack.tsx`, `usePanelGridSave` successors to describe the new split accurately
- [x] 2.6 Clean up trivial style debt (DESIGN.md tokens, canonical breakpoints) ONLY in files already edited by 2.1–2.5

## 3. Tests

### Tests

- [x] 3.1 Regression test (ticket AC): appearance edit staged at phone width flushes via `updatePanelsBatch` on the auto-save tick, pending cleared, zero layout PATCH
- [x] 3.2 Regression test: "Save now" at phone width dispatches `updatePanelsBatch`; no-op when clean
- [x] 3.3 Regression test: pending updates staged at desktop survive a width drop below 768px and flush on the next tick
- [x] 3.4 Rewrite obsolete HEL-301 test (PanelGrid.test.tsx "does not register a save-flush handle"): handle exists at phone width, flushes panel batch, never dispatches layout PATCH
- [x] 3.5 Re-assert HEL-301 guard: mount / width change / auto-save tick / Save-now at phone width issue zero `updateDashboardLayout` dispatches (xs byte-identity)
- [x] 3.6 If 2.4 implemented: test pure resize across 768px (no user drag) issues zero layout PATCH; staged drag flushes on unmount
- [x] 3.7 Run full gates: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`
- [x] 3.8 Write `files-modified.md` handoff + PR audit note draft listing every mutation path checked (design table + probe evidence)

## Resolution notes

- **Decision 3 (2.4) — FALLBACK chosen (no unmount layout flush).** Probe 1.3 confirmed the staged
  layout IS dropped on a desktop-drag-then-resize-below-768px within 30s, and that a pure resize across
  the boundary fires ZERO layout PATCH today. Per the user's binding remedy (a) — "layout persistence
  stays structurally desktop-only" — and the sacred HEL-301 xs byte-identity guard, an unmount flush is
  NOT added: it would introduce a layout-write path fired by a resize event, blurring the
  structural-desktop-only guarantee. The residual layout edge (desktop drag + window shrink below 768px
  inside the 30s window) is pre-existing, out of scope of AC #1 (which concerns edits MADE at <768px),
  and documented in the PR audit note. The appearance/title strand on that same resize IS fixed by the
  hoisted `usePanelUpdatesFlush`.
- **3.6** — since 2.4 took the fallback, the pure-resize zero-layout-PATCH guard is asserted by
  `PanelGrid.test.tsx` "issues zero layout PATCH on a pure resize across the 768px boundary (no drag)".
