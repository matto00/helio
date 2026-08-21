## Purpose
Heavy, non-critical-path frontend surfaces (chart rendering, markdown rendering, the Proposal Review
route) load via dynamic `import()` rather than the initial entry chunk, behind a shared `Suspense`
fallback that matches the loading pattern of the surface it stands in for — the panel skeleton inside a
panel body, the accent border-spinner for a whole-route wait — with a bundle-visualizer report available
on demand to track chunk composition.

## MODIFIED Requirements

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
