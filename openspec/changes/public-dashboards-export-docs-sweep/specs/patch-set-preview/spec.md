## MODIFIED Requirements

### Requirement: Impact hints are explicit and source-grounded for surviving edit kinds
`EditPreview.impact` SHALL surface the following cascade/staleness consequences, each backed by a
real backend behavior, and SHALL be empty for any edit with no such consequence: a `pipeline`/
`pipelineStep` `update`/`delete` hints that output rows are stale until re-run; a `dataSource`
`delete` hints that it cascades to dependent pipelines; a `dashboard` `delete` hints the number of
panels it cascades to. This requirement replaces the base spec's "Impact hints are explicit and
source-grounded" — the `dataType`-delete unbind hint and the panel `config.outputId` rebind hint
it also described no longer apply (see the REMOVED entry below); the pipeline/dataSource/dashboard
hints it also covered are unchanged and restated here.

#### Scenario: A dashboard delete surfaces its panel count
- **WHEN** a dashboard-delete edit targeting a dashboard with 3 panels is previewed
- **THEN** its `impact` includes a hint naming 3 as the number of cascaded panels

#### Scenario: An ordinary rename has no impact hint
- **WHEN** a dataSource-update edit that only renames the source is previewed
- **THEN** its `impact` is empty

