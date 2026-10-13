## MODIFIED Requirements

### Requirement: Impact hints are explicit and source-grounded for surviving edit kinds
`EditPreview.impact` SHALL surface the following cascade/staleness consequences, each backed by a
real backend behavior, and SHALL be empty for any edit with no such consequence: a `pipeline`/
`pipelineStep` `update`/`delete` hints that output rows are stale until re-run; a `pipeline` `delete`
also hints that it cascades to the pipeline's steps and run history, and, when any exist, names the
panels bound to the pipeline's Outputs and the alert rules targeting them, which the delete removes;
a `dataSource` `delete` hints that it cascades to dependent pipelines; a `dashboard` `delete` hints
the number of panels it cascades to. A panel or alert rule the caller cannot read SHALL be counted,
never named. Panels an earlier edit of the same patch set deletes SHALL NOT be listed. The named
list is bounded (at most five names per kind, the remainder counted). This requirement replaces the
base spec's "Impact hints are explicit and source-grounded" — the `dataType`-delete unbind hint and
the panel `config.outputId` rebind hint it also described no longer apply; the pipeline/dataSource/
dashboard hints it also covered are unchanged except for the pipeline-delete naming added here.

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: A pipeline delete names the panels and alert rules it removes
- **WHEN** a pipeline-delete edit is previewed for a pipeline with an Output bound to a caller-visible panel titled
  "Revenue" and targeted by a caller-owned alert rule named "Revenue drop"
- **THEN** its `impact` includes a hint naming the panel "Revenue" and a hint naming the alert rule "Revenue drop"

#### Scenario: A pipeline delete counts panels the caller cannot see
- **WHEN** a pipeline-delete edit is previewed and one of its Outputs is bound to a panel on a dashboard the caller
  cannot read
- **THEN** its `impact` counts that panel without naming it

#### Scenario: A pipeline delete with nothing bound adds no naming hint
- **WHEN** a pipeline-delete edit is previewed for a pipeline whose Outputs have no panels and no alert rules
- **THEN** its `impact` is exactly the stale-rows hint and the steps/run-history cascade hint

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty
