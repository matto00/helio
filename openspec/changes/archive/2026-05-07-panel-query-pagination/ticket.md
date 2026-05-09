# HEL-207 — Panel query result pagination

## Title
Panel query result pagination

## Description
Handle large Spark result sets gracefully. Backend returns results in pages; table panels support load-more or virtual scrolling. Other panel types (metric, chart) receive pre-aggregated data and are unaffected.

## Acceptance Criteria
(Derived from ticket description)
1. Backend paginates Spark query results — results are returned in pages with configurable page size.
2. Table panels support a "load more" interaction (or virtual scrolling) to fetch subsequent pages.
3. Metric and chart panel types continue to receive pre-aggregated data and are unaffected by pagination.
4. The paginated API contract is defined in OpenAPI spec / JSON schema.
5. Frontend Redux state tracks pagination state (current page, hasMore, loading).
6. Tests cover paginated endpoint and frontend pagination interactions.

## Context
- Parent issue: HEL-144
- Project: Helio v1.3 — Data Pipeline & Registry Hardening
- Priority: Medium
- Part of the Spark integration track — follows HEL-202 (Spark cluster setup), HEL-203 (job submission), HEL-204 (job history logs), HEL-206 (panel query executor)
