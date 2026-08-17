## ADDED Requirements

### Requirement: Chart rendering is code-split from the initial entry chunk
The `echarts`/`echarts-for-react` module graph SHALL be loaded via a dynamic `import()`
(`React.lazy`) from the chart renderer used by the panel grid, rather than statically imported
into the initial JavaScript entry chunk. The chart renderer SHALL be wrapped in a `Suspense`
boundary with a fallback matching the shared loading pattern (DESIGN.md §7: a `Spinner` with a
visible/`aria-label`ed loading message).

#### Scenario: Chart module not present in the initial entry chunk
- **WHEN** the production build's bundle-composition report (from the bundle-visualizer) is
  inspected
- **THEN** the `echarts`/`echarts-for-react` code is present only in a separate, non-entry chunk

#### Scenario: Chart panel shows a loading fallback while its chunk loads
- **WHEN** a dashboard containing a chart panel is opened and the chart chunk has not yet loaded
- **THEN** the panel body shows the shared `Spinner`-based loading fallback instead of a blank or
  broken panel, with no console errors

#### Scenario: Chart panel renders normally once its chunk loads
- **WHEN** the chart panel's chunk finishes loading
- **THEN** the chart renders exactly as it did before this change (same requirements as
  `echarts-chart-panel`), with no console errors on mount or unmount

### Requirement: Markdown rendering is code-split from the initial entry chunk
The `react-markdown`/`remark-gfm` module graph SHALL be loaded via a dynamic `import()`
(`React.lazy`) from the markdown renderer used by the panel grid, rather than statically imported
into the initial JavaScript entry chunk. The markdown renderer SHALL be wrapped in a `Suspense`
boundary with a fallback matching the shared loading pattern (DESIGN.md §7).

#### Scenario: Markdown module not present in the initial entry chunk
- **WHEN** the production build's bundle-composition report is inspected
- **THEN** the `react-markdown`/`remark-gfm` code is present only in a separate, non-entry chunk

#### Scenario: Markdown panel shows a loading fallback while its chunk loads
- **WHEN** a dashboard containing a markdown panel is opened and the markdown chunk has not yet
  loaded
- **THEN** the panel body shows the shared `Spinner`-based loading fallback instead of a blank or
  broken panel, with no console errors

#### Scenario: Markdown panel renders normally once its chunk loads
- **WHEN** the markdown panel's chunk finishes loading
- **THEN** the markdown renders exactly as it did before this change (same requirements as
  `markdown-panel`), with no console errors

### Requirement: Proposal Review route is code-split from the initial entry chunk
The `/proposals/review` route's `ProposalReviewPage` component SHALL be loaded via a dynamic
`import()` (`React.lazy`) from the app's route table, rather than statically imported into the
initial JavaScript entry chunk. The route SHALL be wrapped in a `Suspense` boundary with a
page-level fallback matching the shared loading pattern (DESIGN.md §7).

#### Scenario: Proposal Review module not present in the initial entry chunk
- **WHEN** the production build's bundle-composition report is inspected
- **THEN** the `ProposalReviewPage` module graph is present only in a separate, non-entry chunk

#### Scenario: Navigating to the Proposal Review route shows a loading fallback while its chunk loads
- **WHEN** a user navigates to `/proposals/review` and the route's chunk has not yet loaded
- **THEN** the page shows the shared `Spinner`-based loading fallback instead of a blank screen,
  with no console errors

#### Scenario: Proposal Review route renders normally once its chunk loads
- **WHEN** the `/proposals/review` route's chunk finishes loading
- **THEN** the page renders and behaves exactly as it did before this change

### Requirement: A bundle-composition report is produced by the build
The frontend build SHALL support producing a bundle-composition report (via a dev-only
bundle-visualizer plugin) identifying the largest chunks and dependencies, without being enabled
unconditionally on every production build invocation.

#### Scenario: Bundle report can be generated on demand
- **WHEN** the build is run with the analysis mode enabled (e.g. an `ANALYZE=true` env var or a
  dedicated npm script)
- **THEN** a bundle-composition report is produced identifying the largest chunks/dependencies

#### Scenario: Ordinary production builds are unaffected
- **WHEN** the build is run without the analysis mode enabled
- **THEN** the build output and behavior are unchanged from before this change
