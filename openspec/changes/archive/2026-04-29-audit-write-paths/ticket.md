# HEL-154: Audit current write paths across dashboard session

## Title
Audit current write paths across dashboard session

## Description
Identify all individual PATCH/POST calls made during a normal dashboard session: layout changes, panel appearance updates, zoom, name changes, etc. Document the call volume and payload shapes as a baseline for the batch API design.

## Acceptance Criteria
- All PATCH/POST write paths triggered during a normal dashboard session are identified and listed
- For each write path: endpoint, trigger, payload shape, and approximate call frequency are documented
- Call volume baseline is established (e.g. how many API calls per typical interaction)
- Output is suitable to inform the batch API design (parent: HEL-135)

## Context
- Parent issue: HEL-135
- Project: Helio v1.1 — UX Foundations
- Priority: High
