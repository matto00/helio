# HEL-203 — Async Spark Job Tracking

## Title
Async Spark job tracking

## Description
Poll Spark for job status (queued / running / succeeded / failed) and surface it in the pipeline run status indicator. Frontend polls the backend status endpoint; backend polls Spark. Updates the pipeline record on completion.

## Acceptance Criteria
- Backend polls the Spark cluster for job status at a reasonable interval
- Job status transitions: queued → running → succeeded / failed
- Pipeline record is updated in the database when the job completes (succeeded or failed)
- Frontend polls a backend status endpoint to get the current pipeline run status
- The pipeline run status indicator in the UI reflects the current state (queued, running, succeeded, failed)
- Polling stops on terminal states (succeeded / failed)

## Context
- Parent ticket: HEL-143
- Project: Helio v1.3 — Data Pipeline & Registry Hardening
- Priority: Medium
