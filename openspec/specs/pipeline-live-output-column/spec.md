# pipeline-live-output-column Specification

## Purpose
Defines the live Output view on the pipeline detail page: one Output rendered from the walked draft (or saved) rows with the dashboard panel renderers, its tiles and one-time baseline, its live, updating, stale and not-previewed states, and its placement at desktop, narrow-desktop and phone widths.

## Requirements

### Requirement: The pipeline page renders one Output from the walked rows of its node
The pipeline detail page SHALL render a live Output view showing one of the pipeline's Outputs, rendered from the rows of that Output's node in the client walk (the draft walk while a draft exists, the saved pipeline's walk over the same cached sample otherwise), using the Output's saved config and the same renderer components a dashboard panel uses. It SHALL NOT write a snapshot. The displayed Output SHALL be the one the user picked in the view's selector when there are two or more Outputs, else the Output on the selected step, else the first Output. A pipeline with no Output SHALL show an empty state and send no request for it.

#### Scenario: Draft edit updates the Output render
- **WHEN** a draft edit to a client-evaluable step changes the rows of the displayed Output's node
- **THEN** the Output render and the rows-out tile show the draft rows' result

#### Scenario: Several Outputs
- **WHEN** a pipeline has two Outputs and the user selects a step that carries the second
- **THEN** the view shows the second Output, and the selector lists both

### Requirement: The live Output render matches the saved panel for the same rows
For the same rows and Output config, the live Output render SHALL produce the same chart series and the same metric value as the dashboard panel's render, through shared render-input functions. A metric's headline in the live view SHALL be computed from the walked rows, never from the Output's saved history.

#### Scenario: Parity
- **WHEN** the same records are rendered by the saved panel path (with no history) and by the live view
- **THEN** the chart series and the metric value text are identical

#### Scenario: Saved history differs from draft rows
- **WHEN** the Output's latest history value differs from the aggregate of the draft rows
- **THEN** the saved panel shows the history value and the live view shows the draft rows' value

### Requirement: Summary tiles and the one-time baseline
The view SHALL show a rows-out tile and, when the Output's kind has one, a key-aggregate tile computed with `computeAggregate`. The rows-out tile SHALL show the difference against the Output's latest history point's row count when one exists and the root sample is not truncated. The history SHALL be read with at most one `GET /api/outputs/:id/history` per displayed Output per page load, and once more after a run; no edit, step selection, Discard or draft change SHALL read it.

#### Scenario: Baseline read once
- **WHEN** the page loads and the user makes ten client-evaluable edits
- **THEN** exactly one history request for the displayed Output is made, at load, and none during the edits

#### Scenario: Truncated sample
- **WHEN** the root sample is the first 1,000 rows of a larger source
- **THEN** the rows-out tile carries the sample marker and shows no "vs last run" difference

### Requirement: Caption, live marker and stale states
While a draft exists the view SHALL show the caption "Rendered from the draft. Nothing is written until you save and run.". The "live" marker (success-intent dot and lowercase mono "live") SHALL show only while the displayed node's frame is the current draft's; while a server fallback for it is in flight the view SHALL show "updating" and the last good frame; while an upstream step is in error or the frame is a last-good one it SHALL show "stale". With no draft the view SHALL show no "live" marker.

#### Scenario: Error upstream
- **WHEN** a draft edit puts a step above the Output's node in error
- **THEN** the view keeps the last good render, shows "stale", and the "live" marker is absent

#### Scenario: No draft
- **WHEN** the page is open with no draft
- **THEN** the view renders the saved pipeline over the sample and no "live" marker is shown

### Requirement: Not-previewed nodes show saved data labelled stale
An Output whose node is not previewed (an AI step or downstream of one), whose node has no draft rows to show, or whose pipeline has no usable sample (sample error, an image source, or no sample for this viewer) SHALL render its saved rows from one `GET /api/outputs/:id/rows` per page load, labelled stale while a draft exists. An Output bound to a pipeline root SHALL render the root's sample frame and SHALL NOT show the "live" marker. Live columns are ordered by the Output's declared schema; a saved panel's column order is not reproducible client-side, so an order-dependent render (a chart with no x-axis mapping) MAY differ from a saved panel.

#### Scenario: Output below an AI step
- **WHEN** a draft exists and the displayed Output's node is downstream of an AI step
- **THEN** the view renders the Output's saved rows and labels them stale

#### Scenario: No usable sample
- **WHEN** the root source's sample failed to load
- **THEN** the view renders the Output's saved rows instead of a never-ending loading state

### Requirement: Placement at every width
Above the phone boundary, when the page is wide enough for three columns, the view SHALL occupy the `live-output` track at about 340-380px. Below that width it SHALL render as a collapsible "Output" section under the preview table. At or below 768px it SHALL render in the Preview tab. The 1280×800 no-document-scroll requirement SHALL still hold.

#### Scenario: Desktop 1280
- **WHEN** a pipeline with an Output is opened at 1280×800
- **THEN** the live Output column is visible to the right of the preview table, between 340 and 380px wide, and the document does not scroll

#### Scenario: Phone
- **WHEN** the same pipeline is opened at 375px and the Preview tab is shown
- **THEN** the Output view renders in the Preview tab
