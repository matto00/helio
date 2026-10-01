## Context

`DesktopPanelGrid` feeds RGL `Responsive` with `layouts` derived from the store. During a drag RGL's `onLayoutChange`
only writes `latestLayoutRef` (`useLayoutSave.markLayoutChanged`); layout persistence is the 30s `AUTO_SAVE_INTERVAL_MS`
tick, Save-now, or unmount (not a 250ms debounce, which CLAUDE.md wrongly states). `Responsive` re-syncs internal state
only when the `layouts` prop differs from the previous prop (`deepEqual(propsLayouts, prevLayoutsRef.current)`).
Reproduced live (md, lg, sm container widths): drag, undo at ~100ms leaves the panel at the dragged position; drag,
wait 32s (autosave), undo reverts. Redo after an early undo is also wrong: `undoLayout` receives the store layout, which
is still pre-drag, as `currentLayout`. Hypothesis "onLayoutChange echo overwrites undo" was probed and refuted; undo
does not push history or persist the pre-undo layout.

## Decisions

Design-gate round 1 REFUTE (skeptic-design-1.md) corrected two defects in the first draft; both are resolved below.
Verified in RGL 2.2.4 source: `onDragStop`/`onResizeStop` fire BEFORE `onLayoutChange`, and `onLayoutChange` is
suppressed while a drag is active, so at stop time `latestLayoutRef` is still the pre-drag layout.

1. **Commit the live layout to the store via a pending-commit flag.** `handleDragStop`/`handleResizeStop` (after
   `pushLayoutSnapshot`) set a `commitOnNextLayoutChangeRef = true`. `handleLayoutChange` (after
   `markLayoutChanged(next)`) consumes it: when the flag is set and `next` differs from the store layout it dispatches
   `setDashboardLayoutLocally({dashboardId, layout: next})`, then clears the flag. A drag/resize that moved nothing
   produces no `onLayoutChange`, so the flag is also cleared at the next `onDragStart`/`onResizeStart` and by a
   zero-delay timer scheduled in the stop handler (the layout-change callback follows in the same event turn); the
   executor verifies the timing against a real browser. The store then equals what the user sees, so the `layouts`
   prop changes at stop, a later undo value differs from the previous prop, and RGL resyncs with no key/remount trick;
   and the `currentLayout` handed to `undoLayout`/`redoLayout` is the displayed layout, fixing redo. Rejected: keying
   `Responsive` by a history revision (fixes only undo, leaves redo's wrong `currentLayout`); merging the stop
   callback's single-breakpoint layout (no breakpoint is provided).
2. **Re-baseline everything except the two local-edit sources.** Design-gate round 2 REFUTE: advancing
   `persistedLayoutRef` only on server acknowledgement would turn every non-interaction layout change (panel create's
   `setDashboardLayoutLocally` in `panelThunks.ts`, panel delete, `resolveDashboardLayout` projection/default
   placement) into an unrequested layout PATCH, because today the `resolvedLayout` effect re-baselines on every store
   change. So the effect keeps re-baselining (`persistedLayoutRef = resolvedLayout`, pending reset) by default and
   skips it ONLY when the store change is one of two known local edits that must remain dirty:
   (a) the interaction commit of Decision 1, recorded in a `localCommitRef` (`useLayoutSave` exposes
   `commitInteractionLayout(next)`, which sets the ref and returns it for the caller to dispatch), matched with
   `areDashboardLayoutsEqual(resolvedLayout, localCommitRef.current)`; (b) an undo/redo, detected by a per-dashboard
   monotonically increasing `revision` counter added to `layoutHistorySlice` (bumped in `undoLayout`/`redoLayout`,
   selected via `selectLayoutRevision`) compared with the value seen by the previous effect run. In those two
   branches `persistedLayoutRef` is NOT advanced and the effect dispatches `setLayoutPending(!equal(resolved,
   persisted))`. `persistedLayoutRef` is also set to the sent layout in `persistLayout`'s fulfilled handler.
   Sequences: drag then flush sends the dragged layout; drag, undo, redo, flush sends it (never lost); drag, undo,
   flush sends nothing and pending clears (store equals the unmoved persisted layout, fixing the stuck flag); panel
   create/delete or refetch re-baselines with no PATCH, exactly as today. A late PATCH response overwriting the store
   while a newer drag is in flight is pre-existing behaviour (noted by the skeptic as non-blocking) and out of scope.
   Equality uses the existing `areDashboardLayoutsEqual` on the same normalised forms compared today.
3. **HEL-1023 interaction, accepted explicitly.** The store write at stop contains exactly the four-breakpoint layout
   `fromResponsiveLayouts` already produces and autosave would PATCH moments later; no new data shape, no reflow or
   derivation change. HEL-1023's render-time reflow reads the store the same way it does after an autosave today.
4. Undo/redo handlers (`useLayoutUndoRedo`, `CommandBar`) are unchanged. Persisting an undo/redo is thereby now
   incidental (via Decision 2(b)): undo to a layout differing from the last server-acknowledged one will be flushed by the next
   autosave/Save-now (new, intended, and tested), which also resolves the probe's secondary divergence. The unit and
   e2e tests assert it. The undo-handler duplication is left alone and noted as a follow-up.

## Risks

- A store write at stop changes `layouts` prop while the drag has just ended: must not retrigger `onLayoutChange`
  loops or an extra PATCH. Covered by the PATCH-count assertion in the e2e and a unit test.
- `hasPendingLayout` must still go true on a drag and false after the flush (existing tests).
- The mobile stack and HEL-301's no-layout-write-below-sm guarantee are untouched (all edits are in desktop-only code).

## Verification

Unit tests fire the stop handler BEFORE the layout-change callback (real RGL order), and cover: drag,
undo, redo, flush gives one PATCH with the dragged layout; drag, undo, flush gives no PATCH; a no-move drag does not
commit; the flag does not leak into a later layout change. Playwright e2e `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts` (real browser, real drag, rendered
`boundingBox`, undo and redo through Ctrl+Z / Ctrl+Shift+Z and the CommandBar buttons, resize, lg and sm container
widths, both themes), shown red on main by running it against the unfixed tree and green after. The `xs` breakpoint has
no RGL grid (container under 768px renders `MobilePanelStack`), so it is asserted as such, not tested for revert.
