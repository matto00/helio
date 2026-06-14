# HEL-263: Aggregate step — UI cleanup and correctness audit

## Title
Aggregate step — UI cleanup and correctness audit

## Description
The Aggregate step's UI needs cleanup and the underlying engine logic needs a correctness audit. User reports uncertainty about whether it works properly.

## UI cleanup

* Standardize the config form to match the patterns established in HEL-235 (TextField / Select primitives, no native HTML)
* Clarify the relationship between "group by" fields and aggregate functions
* Add inline hints for each aggregate function (sum/avg/min/max/count, etc.)
* Surface validation errors per-field, not as a single bottom-of-form blob

## Correctness audit

* Verify each supported aggregate function produces correct output across:
  * Empty inputs
  * Single-row inputs
  * Multi-group inputs
  * Null values (do they participate in count? Are they ignored in sum/avg?)
  * Mixed types
* Compare against the analyze-endpoint output schema — does the inferred output match what `apply` actually produces?

## Definition of done

* Aggregate step UI matches HEL-235 polish bar (primitive components, consistent spacing, clear validation)
* Correctness regression tests for each aggregate function × null/empty/multi-group case
* Any discrepancy between analyze-inferred schema and apply-produced schema fixed (apply/infer parity per feedback_pipeline_op_wiring)

## Priority
Medium

## Project
Helio v1.3.1 — Polish & Hardening

## Parent
HEL-241
