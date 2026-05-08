# spark-query-pushdown Specification

## Purpose
TBD - created by archiving change spark-query-pushdown. Update Purpose after archive.
## Requirements
### Requirement: PanelQuery filters are pushed into Spark before collect
The system SHALL apply each filter expression in `PanelQuery.filters` to the Spark DataFrame via
`DataFrame.filter(expr)` before calling `collectRows()`. Items in `filters` that are `JsString` values
are used as raw Spark SQL expressions. Non-`JsString` items SHALL be skipped without error.

#### Scenario: Single filter expression reduces result rows
- **WHEN** `PanelQuery.filters = [JsString("price > 15.0")]` is executed against a static DataSource with
  rows at prices 10.0, 20.0, 30.0
- **THEN** the result contains only the rows where price > 15.0

#### Scenario: Multiple filter expressions are ANDed together
- **WHEN** `PanelQuery.filters = [JsString("price > 5.0"), JsString("qty < 10")]` is executed
- **THEN** only rows satisfying both conditions are returned

#### Scenario: Empty filters list returns all rows unfiltered
- **WHEN** `PanelQuery.filters = Nil`
- **THEN** all rows from the source are returned (subject to other pushdowns)

### Requirement: PanelQuery sort is pushed into Spark before collect
The system SHALL apply `PanelQuery.sort` (when set) as a Spark SQL expression via `DataFrame.orderBy(expr)`
before calling `collectRows()`. When `sort` is `None`, no ordering is applied.

#### Scenario: Sort expression orders rows ascending
- **WHEN** `PanelQuery.sort = Some("price ASC")` is executed against a DataSource with rows at prices
  30.0, 10.0, 20.0
- **THEN** result rows are ordered 10.0, 20.0, 30.0

#### Scenario: Sort is None — row order is not constrained
- **WHEN** `PanelQuery.sort = None`
- **THEN** `PanelQueryExecutor` does not call `orderBy` and returns rows in source order

### Requirement: PanelQuery limit is pushed into Spark before collect
The system SHALL apply `PanelQuery.limit` (when set) via `DataFrame.limit(n)` before calling
`collectRows()`. When `limit` is `None`, no row-count restriction is applied.

#### Scenario: Limit restricts the number of collected rows
- **WHEN** `PanelQuery.limit = Some(2)` and the DataSource has 5 rows
- **THEN** exactly 2 rows are returned

#### Scenario: Limit is None — all rows are collected
- **WHEN** `PanelQuery.limit = None` and the DataSource has 5 rows
- **THEN** all 5 rows are returned

### Requirement: All pushdowns compose correctly in a single query
The system SHALL correctly compose projection, filter, sort, and limit when all four are specified in
a single `PanelQuery`, applying them in the order: select → filter → sort → limit.

#### Scenario: Combined projection, filter, and limit return correct subset
- **WHEN** `PanelQuery(selectedFields = ["price"], filters = [JsString("price > 10")], sort = Some("price DESC"), limit = Some(2))`
  is executed against a DataSource with (price=5), (price=15), (price=25), (price=35)
- **THEN** the result contains exactly 2 rows with only the "price" column and values [35, 25]

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

