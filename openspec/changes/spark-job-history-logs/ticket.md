# HEL-204: Spark job history and logs in pipeline tab

## Title
Spark job history and logs in pipeline tab

## Description
Per-pipeline run history list in the detail view: each run shows start time, duration, row count, and status. Failed runs include error output / Spark logs. Retain last N runs per pipeline.

## Acceptance Criteria
- The pipeline detail view includes a run history list
- Each run entry shows: start time, duration, row count, and status
- Failed runs display error output / Spark logs
- The system retains the last N runs per pipeline (configurable or fixed cap)

## Project
Helio v1.3 — Data Pipeline & Registry Hardening

## Priority
Medium

## Linear URL
https://linear.app/helioapp/issue/HEL-204/spark-job-history-and-logs-in-pipeline-tab
