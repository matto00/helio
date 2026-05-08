## ADDED Requirements

### Requirement: PanelQueryExecutor caches DataFrames used in paginated queries
The system SHALL call `.cache()` on the base DataFrame before executing a paginated panel query
(when both a count and a page-slice action are needed) and call `.unpersist()` after both actions
complete, eliminating redundant re-computation of the same DataFrame plan.

#### Scenario: Cached DataFrame is not recomputed for the page-slice after a count
- **WHEN** a paginated `PanelQuery` (with `page` and `pageSize` set) is executed
- **THEN** the DataFrame is cached before the first action and unpersisted after the second, so the
  physical plan is only computed once per query invocation

#### Scenario: Non-paginated queries do not cache unnecessarily
- **WHEN** a non-paginated `PanelQuery` (no page/pageSize) is executed
- **THEN** no `.cache()` call is made and the DataFrame is evaluated once directly
