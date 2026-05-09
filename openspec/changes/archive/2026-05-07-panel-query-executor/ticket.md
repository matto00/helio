# HEL-206: Panel query executor: submit panel queries to Spark

## Title
Panel query executor: submit panel queries to Spark

## Description
Backend service that accepts a panel query and submits it to Spark. Returns result rows to the frontend. Replaces direct DataType snapshot reads. Consistent with the pipeline execution path.

## Acceptance Criteria
- A new backend endpoint accepts a panel query (referencing a data source) and submits it to Spark for execution
- The endpoint returns result rows to the frontend
- This replaces any direct DataType snapshot reads for panel data
- The implementation is consistent with the existing pipeline execution path
- The new endpoint is covered by backend tests

## Related Issues
- Parent: HEL-144
- Related to: HEL-232 (Pipeline results: persist snapshots to Apache Iceberg tables)

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Priority
Medium
