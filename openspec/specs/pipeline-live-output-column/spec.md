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
For the same rows and Output config, the live Output render SHALL produce the same chart series and the same metric value as the dashboard panel's render, through shared render-input functions. A metric's headline in the live view SHALL be computed from the walked rows, never from the Output's saved history. When the Output's config sets `compare`, the live view SHALL draw the same compare overlay a dashboard chart panel draws and the same metric comparison a dashboard metric panel shows, from the Output's saved history baseline, over the draft rows; the metric comparison's difference SHALL be measured from the draft rows' value. The overlay SHALL be hidden under the same conditions the dashboard hides it, including rows that are a truncated sample or a draft-preview `rows` line marked `truncated`. When the latest history value is null but a valid baseline exists, the live metric comparison SHALL still be shown against the draft value.

#### Scenario: Parity
- **WHEN** the same records are rendered by the saved panel path (with no history) and by the live view
- **THEN** the chart series and the metric value text are identical

#### Scenario: Saved history differs from draft rows
- **WHEN** the Output's latest history value differs from the aggregate of the draft rows
- **THEN** the saved panel shows the history value and the live view shows the draft rows' value

#### Scenario: Compare overlay parity
- **WHEN** a chart Output with `compare` set and a valid baseline in its history is rendered by the saved panel path and by the live view from the same records and history
- **THEN** both renders draw an identical overlay series and label

#### Scenario: Metric comparison against the draft value
- **WHEN** a metric Output with `compare` set has a history baseline and the draft rows' value differs from the latest history value
- **THEN** the live view shows the comparison against the baseline with the difference computed from the draft rows' value

### Requirement: Summary tiles and the one-time baseline
The view SHALL show a rows-out tile and, when the Output's kind has one, a key-aggregate tile computed with `computeAggregate`. A single-series line or bar chart Output with no aggregation (a plain chart), with an x and a y field mapped, SHALL instead show a second tile labelled `LATEST <Y>` holding the y field's value at the last point with a numeric y in the order the chart plots its rows (the time-axis plan's order, not record order); it SHALL be absent for an aggregated chart, a chart with a series field, a pie, scatter, heatmap or histogram chart, a chart with no x or y mapped, and a chart with no rows. The rows-out tile SHALL show the difference against the Output's latest history point's row count when one exists and the root sample is not truncated. The history SHALL be read with at most one `GET /api/outputs/:id/history` per displayed Output per page load, and once more after a run; no edit, step selection, Discard or draft change SHALL read it.

#### Scenario: Baseline read once
- **WHEN** the page loads and the user makes ten client-evaluable edits
- **THEN** exactly one history request for the displayed Output is made, at load, and none during the edits

#### Scenario: Truncated sample
- **WHEN** the root sample is the first 1,000 rows of a larger source
- **THEN** the rows-out tile carries the sample marker and shows no "vs last run" difference

#### Scenario: Plain chart tile
- **WHEN** the displayed Output is a line chart with a timestamp x and a y mapping, no aggregation, and its records are not in time order
- **THEN** a `LATEST <Y>` tile shows the y value of the latest-in-time point, not of the last record

#### Scenario: No tile for a pie chart
- **WHEN** the displayed Output is an unaggregated pie chart
- **THEN** only the rows-out tile is shown

### Requirement: Caption, live marker and stale states
While a draft exists the view SHALL show the caption "Rendered from the draft. Nothing is written until you save and run.". The "live" marker (success-intent dot and lowercase mono "live") SHALL show only while the displayed frame is the current draft's; while a newer draft frame exists but has not yet been rendered (the render is settling), and while a server fallback for the node is in flight, the view SHALL show "updating" and the last rendered frame; while an upstream step is in error or the frame is a last-good one it SHALL show "stale". An upstream error's message SHALL NOT be repeated in the view's note, since the step editor and the preview table already show it. With no draft the view SHALL show no "live" marker.

#### Scenario: Error upstream
- **WHEN** a draft edit puts a step above the Output's node in error
- **THEN** the view keeps the last good render, shows "stale", the "live" marker is absent, and the error message appears in the editor and preview table but not in the Output view

#### Scenario: Settling after an edit
- **WHEN** a draft edit changes the Output's node rows and the newer frame has not rendered yet
- **THEN** the view shows "updating" instead of "live" until the newer frame renders, then shows "live"

#### Scenario: Unrelated re-render
- **WHEN** the page re-renders for a reason that does not change the Output's node frame (a dialog opens, a run status changes)
- **THEN** the view keeps its marker and does not show "updating"

#### Scenario: No draft
- **WHEN** the page is open with no draft
- **THEN** the view renders the saved pipeline over the sample and no "live" marker is shown

### Requirement: Not-previewed nodes show saved data labelled stale
An Output whose node is not previewed (an AI step or downstream of one), whose node has no draft rows to show, or whose pipeline has no usable sample (sample error, an image source, or no sample for this viewer) SHALL render its saved rows from one `GET /api/outputs/:id/rows` per page load, labelled stale while a draft exists. An Output bound to a pipeline root SHALL render the root's sample frame and SHALL NOT show the "live" marker. Live columns and saved panel columns, including a saved table panel with no column order configured, SHALL both be ordered by the Output's declared schema, then any column the schema does not name in ascending code-point order, so an order-dependent render (a table with no column config, a chart with no x-axis mapping) is the same in the live view and on a saved panel, including for column names that are integer-like. A saved panel whose rows carry no column list (an old cached window) SHALL keep its previous ordering.

#### Scenario: Output below an AI step
- **WHEN** a draft exists and the displayed Output's node is downstream of an AI step
- **THEN** the view renders the Output's saved rows and labels them stale

#### Scenario: No usable sample
- **WHEN** the root source's sample failed to load
- **THEN** the view renders the Output's saved rows instead of a never-ending loading state

#### Scenario: Same column order live and saved
- **WHEN** an Output with schema columns `zeta, 10, alpha` and no column config is rendered as a table live and on a saved table panel
- **THEN** both show the columns in the order `zeta, 10, alpha`

### Requirement: Placement at every width
Above the phone boundary, when the page is wide enough for three columns, the view SHALL occupy the `live-output` track at about 340-380px. Below that width it SHALL render as a collapsible "Output" section under the preview table. At or below 768px it SHALL render in the Preview tab. The 1280×800 no-document-scroll requirement SHALL still hold.

#### Scenario: Desktop 1280
- **WHEN** a pipeline with an Output is opened at 1280×800
- **THEN** the live Output column is visible to the right of the preview table, between 340 and 380px wide, and the document does not scroll

#### Scenario: Phone
- **WHEN** the same pipeline is opened at 375px and the Preview tab is shown
- **THEN** the Output view renders in the Preview tab

### Requirement: A continuous burst of edits still updates the view
While draft edits keep arriving without a pause, the live Output view SHALL still render the latest frame at least
once every 1500 ms plus at most one idle timeout, whether or not the browser provides `requestIdleCallback`.

#### Scenario: Edits every 100 ms for 3 s
- **WHEN** draft edits arrive every 100 ms for 3 seconds
- **THEN** the view renders an intermediate frame before the burst ends, not only after it

### Requirement: An unfocused server-resolved Output refreshes when the draft changes
While a draft exists, an Output whose node is server-resolved SHALL render the current draft's rows for its node whether
or not its step is selected. The rows SHALL arrive on the same paced draft-preview request that serves the selected step;
a draft change SHALL NOT cause more draft-preview requests than it did before this change. The "Select this step to
update it" note SHALL show only when the node's rows were not returned (for example, a superseded or failed request, or no `rows` line for the node).

#### Scenario: Edit above an unfocused server-resolved Output
- **WHEN** a draft exists, the displayed Output's node is downstream of a server-evaluated step, another step is selected,
  and the user edits a step above the Output's node
- **THEN** after the paced request settles the Output renders the edited draft's rows with the "live" marker, and no
  "Select this step to update it" note is shown

#### Scenario: Request count is unchanged
- **WHEN** the user makes a burst of draft edits with an unfocused server-resolved Output displayed
- **THEN** the number of draft-preview requests equals the number sent for the same burst with no Output displayed
