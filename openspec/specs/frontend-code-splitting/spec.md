# frontend-code-splitting Specification

## Purpose
Heavy, non-critical-path frontend surfaces (chart rendering, markdown rendering, the Proposal Review
route) load via dynamic `import()` rather than the initial entry chunk, behind a `Suspense` fallback that
matches the loading pattern of the surface it stands in for — the panel skeleton inside a panel body, the
accent border-spinner for a whole-route wait — with a bundle-visualizer report available on demand to
track chunk composition.

## Requirements

### Requirement: Chart rendering is code-split from the initial entry chunk
The `echarts`/`echarts-for-react` module graph SHALL be loaded via a dynamic `import()`
(`React.lazy`) from the chart renderer used by the panel grid, rather than statically imported
into the initial JavaScript entry chunk. The chart renderer SHALL be wrapped in a `Suspense`
boundary whose fallback matches the shared loading pattern the panel body itself uses for a data load
(DESIGN.md §7), so that a chunk load and a data load remain visually indistinguishable inside the same
panel card. The fallback SHALL expose an accessible loading name.

#### Scenario: Chart module not present in the initial entry chunk
- **WHEN** the production build's bundle-composition report (from the bundle-visualizer) is
  inspected
- **THEN** the `echarts`/`echarts-for-react` code is present only in a separate, non-entry chunk

#### Scenario: Chart panel shows a loading fallback while its chunk loads
- **WHEN** a dashboard containing a chart panel is opened and the chart chunk has not yet loaded
- **THEN** the panel body shows the shared loading fallback instead of a blank or broken panel, with no
  console errors

#### Scenario: Chart panel renders normally once its chunk loads
- **WHEN** the chart panel's chunk finishes loading
- **THEN** the chart renders exactly as it did before this change (same requirements as
  `echarts-chart-panel`), with no console errors on mount or unmount

#### Scenario: The chunk fallback matches the panel's own data-loading treatment
- **WHEN** a panel body's chunk fallback and the same panel's data-loading state are compared
- **THEN** they present the same loading treatment

### Requirement: Markdown rendering is code-split from the initial entry chunk
The `react-markdown`/`remark-gfm` module graph SHALL be loaded via a dynamic `import()`
(`React.lazy`) from the markdown renderer used by the panel grid, rather than statically imported
into the initial JavaScript entry chunk. The markdown renderer SHALL be wrapped in a `Suspense`
boundary whose fallback matches the shared loading pattern the panel body itself uses for a data load
(DESIGN.md §7), so that a chunk load and a data load remain visually indistinguishable inside the same
panel card.

#### Scenario: Markdown module not present in the initial entry chunk
- **WHEN** the production build's bundle-composition report is inspected
- **THEN** the `react-markdown`/`remark-gfm` code is present only in a separate, non-entry chunk

#### Scenario: Markdown panel shows a loading fallback while its chunk loads
- **WHEN** a dashboard containing a markdown panel is opened and the markdown chunk has not yet
  loaded
- **THEN** the panel body shows the shared loading fallback instead of a blank or broken panel, with no
  console errors

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

### Requirement: Chart code is preloaded once a chart-kind Output is known
Whenever the client resolves the metadata of an Output bound to a panel being shown and its kind is `chart` -- fetched for the signed-in app, restored
from the warm cache, or fetched for a public or share-token viewer -- the client SHALL begin loading the chart
rendering code immediately, without waiting for the chart component to mount or for the Output's rows to arrive.
The preload SHALL use the same chunk the chart renderer loads (one request, not two), SHALL NOT move the
`echarts`/`echarts-for-react` code into the initial entry chunk, and SHALL NOT surface an unhandled rejection or console error when it fails: a failed
preload leaves the chart exactly as it behaved before this change. The loader's own memo is cleared on failure (proven at unit
level only); the browser caches a failed dynamic import per page, so no real-browser retry is added. Outputs of other kinds SHALL NOT trigger the chart preload.

#### Scenario: Chart chunk is requested before the chart's rows arrive
- **WHEN** a dashboard with a chart-kind Output panel is opened and that Output's rows response is held back
- **THEN** the chart chunk is requested while the rows are still pending, and the chart renders once the rows arrive

#### Scenario: Warm-restored and public chart Outputs also preload
- **WHEN** a chart Output's metadata is restored from the warm cache, or fetched by a public or share-token viewer
- **THEN** the chart chunk loading starts at that moment, not when the chart component mounts

#### Scenario: Non-chart Outputs do not load chart code
- **WHEN** a dashboard whose panels are all table, metric or markdown Outputs is opened
- **THEN** no chart chunk is requested

#### Scenario: A failed preload raises no error of its own
- **WHEN** the preload request for the chart chunk fails once
- **THEN** no unhandled rejection or console error is raised by the preload, and the chart panel behaves as it did before this change: its own load surfaces the failure through the existing panel error boundary. The browser caches a failed dynamic import per page, so this change adds no real-browser retry (the loader memo's clear-on-failure is proven at unit level only)

#### Scenario: The chart module stays out of the initial entry chunk
- **WHEN** the production build's bundle-composition report is inspected after this change
- **THEN** the `echarts`/`echarts-for-react` code is present only in a separate, non-entry chunk
