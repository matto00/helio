## MODIFIED Requirements

### Requirement: Dashboard chart panels render config.aggregation
A dashboard chart panel bound to an aggregated chart Output (its `config.chartType` is not `scatter` and
`config.aggregation` names a groupBy, a supported agg and a yField) SHALL plot one value per group, computed from the
panel's loaded row records with the same grouping function and the same aggregation condition the Output editor
preview uses, on every surface that renders the panel (dashboard card, mobile stack, fullscreen, detail modal, public
viewer). Grouping SHALL operate on the loaded row records, after any client-side cross-filter narrowing, so missing
values group as the preview and the stored summary series group them. A click on an aggregated chart's category SHALL produce a selection whose dimension
is the aggregation's groupBy and whose value is the clicked category, except that a click on the category labelled
`null` SHALL produce the value `""` (blank) when any loaded row's groupBy value is null. The Inspect view it opens SHALL list exactly the loaded rows whose groupBy value equals that
category; for a blank selection, exactly the rows whose groupBy value is null or the empty string (rows lacking the
groupBy key are not included). The aggregated
primary series SHALL be named `<agg>(<yField>)`.

#### Scenario: Aggregated bar chart on a dashboard matches the editor preview
- **WHEN** a bar chart Output aggregates `sum(amount)` by `region` over rows east=10, east=5, west=7
- **THEN** the dashboard panel shows two bars, east 15 and west 7, as the editor preview does

#### Scenario: Fullscreen and detail modal agree
- **WHEN** the same panel is opened fullscreen or in the detail modal
- **THEN** it shows the same two grouped bars

#### Scenario: Click selects the groupBy dimension
- **WHEN** a viewer clicks the `west` bar
- **THEN** the selection's dimension is `region` and its value is `west`

#### Scenario: Inspect lists the clicked group's rows
- **WHEN** a viewer clicks the `west` bar of that chart
- **THEN** the Inspect view lists exactly the `region = west` rows

#### Scenario: Click on the null group selects blank
- **WHEN** a viewer clicks the bar labelled `null` and the loaded rows include rows whose `region` is null
- **THEN** the selection's dimension is `region` and its value is `""`, and Inspect lists the rows whose `region` is
  null or the empty string

#### Scenario: A literal "null" category without nulls keeps its value
- **WHEN** no loaded row's `region` is null and a viewer clicks the bar labelled `null` (rows holding the string `"null"`)
- **THEN** the selection's value is `"null"` and Inspect lists exactly those rows
