## Purpose

Defines how a null (blank) category or selection value is labelled in the UI, so users see "(blank)" instead of
"null" or an empty string, without changing which rows a selection matches.

## ADDED Requirements

### Requirement: Aggregated charts label a null category "(blank)"
An aggregated chart (bar, line or pie, on a dashboard panel or in the Output editor preview) whose grouped records
contain a null value for the group-by field SHALL label that category "(blank)" on the category axis, pie slice,
legend and tooltip. When no record holds a null for the group-by field, a category whose text is literally "null"
SHALL still display as "null". The category's position in the category order SHALL be unchanged.

#### Scenario: Null group shows as (blank)
- **WHEN** a bar chart aggregates records `{team:"east"}`, `{team:null}`, `{team:"west"}` grouped by `team`
- **THEN** the category axis reads `east`, `(blank)`, `west`

#### Scenario: Horizontal bar shows and selects (blank)
- **WHEN** a horizontal bar chart aggregates records with a null `team` and the user clicks the `(blank)` bar
- **THEN** the category axis reads `(blank)` and the selection value is `""`

#### Scenario: Literal "null" text stays "null"
- **WHEN** a bar chart aggregates records whose `team` is the text `"null"` and no record has a null `team`
- **THEN** that category displays as `null`

#### Scenario: Output editor preview uses the same label
- **WHEN** the Output editor preview renders an aggregated chart over rows with a null group-by value
- **THEN** the preview's category reads `(blank)`

### Requirement: Selecting the blank category keeps null-matching semantics
Clicking the "(blank)" category SHALL produce a selection whose value is the empty string, exactly as clicking the
null category did before this change. Inspect on that selection SHALL list the null (and empty-string) rows, and
"Filter dashboard" SHALL cross-filter siblings to their null or empty-string rows. The stored selection and
cross-filter value SHALL never be the label text.

#### Scenario: Click (blank) then Filter dashboard
- **WHEN** the user clicks the `(blank)` bar of a chart grouped by `team` and chooses "Filter dashboard"
- **THEN** the dashboard cross-filter value for `team` is `""` and a sibling table shows exactly the rows whose
  `team` is null or empty

### Requirement: Selection headers label an empty value "(blank)"
The cross-filter indicator ("Filtered by <field> = <value>"), the Inspect header ("Showing rows for <field>:
<value>") and the Inspect "Filter dashboard by <field> = <value>" button SHALL display "(blank)" when the selection
value is the empty string, and the value unchanged otherwise.

#### Scenario: Indicator shows (blank)
- **WHEN** the dashboard is cross-filtered on `team` with value `""`
- **THEN** the indicator reads `Filtered by team = (blank)`

#### Scenario: Inspect header shows (blank)
- **WHEN** Inspect opens for a selection `{dimension: "team", value: ""}`
- **THEN** its header reads `Showing rows for team: (blank)` and its button reads `Filter dashboard by team = (blank)`

### Requirement: Output history labels a stored null group "(blank)"
Output history grouped series SHALL display a stored category "null" as "(blank)", including history points
captured before this change. A history overlay on a live chart SHALL still align its blank category with the live
chart's blank category.

#### Scenario: Old history point relabelled
- **WHEN** an Output's history holds a grouped point whose categories include `"null"`
- **THEN** the history chart shows that category as `(blank)`

#### Scenario: Overlay aligns on the blank group
- **WHEN** a live aggregated chart with a null group shows a history overlay whose stored categories include `"null"`
- **THEN** the overlay value for the blank group is drawn against the live chart's `(blank)` category

#### Scenario: History "vs" comparison keeps the blank group
- **WHEN** the Output history view shows a grouped point and its "vs" comparison point, both with a `"null"` category
- **THEN** the selected bar and the comparison value for that group are both drawn at the `(blank)` category
