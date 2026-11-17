## ADDED Requirements

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

## MODIFIED Requirements

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
