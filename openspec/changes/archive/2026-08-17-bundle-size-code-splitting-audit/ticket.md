# HEL-512: Bundle-size and code-splitting audit

## Description

The frontend is a Vite build (`npm run build`) with a growing feature surface (charts via an ECharts-class library, markdown rendering, proposal review, PWA). There is no current visibility into bundle composition or route-level code splitting, so heavy dependencies (charting, markdown) likely load on first paint even for users who never open a chart/markdown panel.

## Scope

- Add bundle analysis to the Vite build (e.g. `rollup-plugin-visualizer` or equivalent, dev-only) and capture a baseline of the largest chunks/dependencies. Record the baseline numbers in the PR.
- Introduce route/feature-level code splitting via dynamic `import()` + `React.lazy`/`Suspense` for the heaviest, non-critical-path surfaces — at minimum the charting library (chart panels), markdown rendering, and the Proposal Review page (`frontend/src/features/dashboards/ui/ProposalReviewPage.tsx`). Provide sensible `Suspense` fallbacks using the shared loading pattern (DESIGN.md §7).
- Verify tree-shaking of icon/util barrels; eliminate accidental eager imports of heavy modules from `shared/ui/index.ts` or feature index barrels.
- Keep lazy boundaries from causing layout shift or breaking existing tests; ensure lazily-loaded panels still render under the panel-grid activation gate.

## Acceptance Criteria

- A bundle report is produced by the build with a documented before/after; the largest non-critical dependencies (charts, markdown) are no longer in the initial entry chunk.
- First-load chunk size is measurably reduced (report the number); app functionality unchanged.
- Chart/markdown/proposal surfaces load on demand with a graceful fallback, no console errors.
- Lint (zero-warnings) and all Jest tests pass; no new eager heavy imports.

## Out of Scope

- Backend build/deploy.
- Rewriting the charting library choice.
- Panel-grid runtime virtualization (separate ticket).

## Dependencies

- Coordinate with HEL-351 (table-virtualization ticket) if it adds a windowing library. Binding: DESIGN.md §7, CONTRIBUTING.md.
