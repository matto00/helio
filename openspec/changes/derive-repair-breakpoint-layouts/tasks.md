## 1. Reproduction and red tests (on main first)

- [x] 1.1 Write `e2e/hel1023-breakpoint-layout-derivation.spec.ts`: seed (API) a dashboard with markdown, image,
  chart (output/pipeline helper as in existing e2e specs), text and divider panels; states A (lg only), B (md partial),
  C (lg coordinates under md/sm/xs), D (md overlap), V (valid authored layout with gaps); windows 1900/1500/1200/1056/400;
  assert no pairwise overlap, inside container, byte-identical positions for V, no layout PATCH on view. Run on main:
  record it RED.
- [x] 1.2 Record the red output (failing assertions) in the change dir evidence.

## 2. Pure module

- [x] 2.1 `dashboards/state/breakpointLayout.ts`: `rectsOverlap`, `findOverlaps`, `isLayoutValid`, `compactLayout`,
  `nearestAuthoredBreakpoint` (deriveLayout removed in cycle 2); unit tests incl. repro seeds, order preservation, idempotence, bounds.
- [x] 2.2 Mutation checks: no-compaction mutant, always-compact mutant, no-bounds-check mutant each fail a test.
- [x] 2.2a Resolver-level test: a valid authored layout with gaps is value-identical at EVERY breakpoint and fails under an always-compact mutant.
- [x] 2.2b Precedence tests: overlapping+partial; only-authored-bp overlapping (other bps keep reading order); stale ids; bounds-violating bp never a source.
- [x] 2.3 Rewire `resolveDashboardLayout` per design Decision 2; delete `cleanupOverlaps`/`projectLayout`/
  `pickProjectionSource`; update `dashboardLayout.test.ts`.

- [x] 2.4 Re-verify `DesktopPanelGridSkeleton`, `MobilePanelStackSkeleton`, `panelGridSkeletonStubs.ts` (+ tests, stale comments about `effectiveSaved`/exact-match shortcut) against the new resolver.
- [x] 2.5 `panelThunks.createPanel` test: appended scaled item on empty md/sm/xs arrays resolves valid, no overlap, new panel anchored.

## 3. Grid and persistence

- [x] 3.1 Shifted RGL breakpoints + boundary test via `getBreakpointFromWidth`.
- [x] 3.2 `useLayoutSave`/`DesktopPanelGrid`: store-shaped baseline, edit-only-when-differs-from-resolved,
  single-breakpoint candidate; keep HEL-1028 commit flag logic and `revision` handling.
- [x] 3.3 Tests: drag-away-and-back sends no PATCH; viewing derived layouts dispatches no `setLayoutPending`/`pushLayoutSnapshot`/PATCH; md edit persists
  md only; undo restores the store-shaped layout; referential stability of the layouts prop across re-renders.
- [x] 3.4 `MobilePanelStack` order test from lg-only and overlapping-xs seeds.

## 4. Verify

- [x] 4.1 `e2e/hel1023...` green; `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts` green.
- [x] 4.2 `npm run lint`, `typecheck`, `format:check`, full `npm test` (known flake HEL-1215), openspec hygiene.
- [x] 4.3 Live check both themes against the running worktree app (`readlink /proc/<pid>/cwd`).
- [x] 4.4 Update CLAUDE.md-stale statements only if inside this change's scope (do not edit CLAUDE.md; report).
