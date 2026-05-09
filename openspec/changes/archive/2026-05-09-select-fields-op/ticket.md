# HEL-187 — Pipeline operation: Select fields

## Title
Pipeline operation: Select fields

## Description
Step type: select a subset of fields from the current row set. Unselected fields are dropped from the output.

UI: checklist of available fields from the previous step's output schema.

## Acceptance Criteria
- A new pipeline operation type "select" is supported
- The backend execution engine handles the "select" op: given a list of field names, it drops all columns not in that list from each row
- The frontend step config UI renders a checklist of available fields (derived from the previous step's output schema) and allows the user to pick which fields to keep
- Unselected fields are absent from the output rows passed to the next step
- The "select" op type is persisted (Flyway migration if the DB enum does not already include it)

## Context
- HEL-228 delivered the DB schema + CRUD API for pipeline steps. The existing op type enum is `('rename', 'filter', 'join', 'compute', 'groupby', 'cast')` — "select" is NOT included, so a Flyway migration is required.
- HEL-229 delivered the in-process execution engine. New op types must be wired into the engine's op dispatcher.
- This is the first of 8 v1 pipeline operations under epic HEL-141 (Data Pipeline Editor).

## Epic
HEL-141 — Data Pipeline Editor
