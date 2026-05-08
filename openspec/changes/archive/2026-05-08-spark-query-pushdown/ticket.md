# HEL-208 — Query pushdown into Spark query plans

## Title
Query pushdown into Spark query plans

## Description
Filters, aggregations, and field selections from the panel query are pushed into the Spark query
plan rather than applied in-memory on the application server. Ensures large datasets are handled
efficiently.

## Acceptance Criteria
- `PanelQuery.filters` are translated into Spark filter expressions and applied via `DataFrame.filter()`
  before `collect()` is called — no post-collection in-memory filtering.
- `PanelQuery.selectedFields` (column projection) is applied via `DataFrame.select()` inside Spark —
  already partially done; must confirm it is a proper pushdown and not a post-step.
- `PanelQuery.limit` (when set) is applied via `DataFrame.limit()` inside Spark before `collect()`.
- `PanelQuery.sort` (when set) is applied via `DataFrame.orderBy()` inside Spark before `collect()`.
- `PanelQueryExecutor` uses these pushdown steps in all cases (static and csv source types).
- Tests in `PanelQueryExecutorSpec` cover: filter pushdown, sort pushdown, limit pushdown, and combined
  filter + projection + limit.
- No query predicates are applied in-memory after `collectRows()` is called.

## Parent Epic
HEL-144 — Spark-Backed Panel Queries

## Project
Helio v1.3 — Data Pipeline & Registry Hardening
