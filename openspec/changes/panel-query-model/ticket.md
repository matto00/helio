# HEL-205: Panel query model: structured query per panel

## Title
Panel query model: structured query per panel

## Description
Define the panel query model: each panel emits a structured query derived from its field mapping (selected fields, filters, sort, limit). Query is serializable and passed to the Spark execution layer rather than fetching the full DataType snapshot.

## Acceptance Criteria
(See ticket description — no explicit acceptance criteria listed beyond the description above.)

## Context
- Parent ticket: HEL-144
- Project: Helio v1.3 — Data Pipeline & Registry Hardening
- Priority: Medium

## Key Requirements
1. Each panel has a structured query model derived from its field mapping
2. Query includes: selected fields, filters, sort, limit
3. Query is serializable (JSON-representable)
4. Query is passed to the Spark execution layer
5. Does NOT fetch the full DataType snapshot — query is structured, not a raw data fetch
