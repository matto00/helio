## Why

Panel content currently feels sparse relative to panel containers: padding is inconsistent, font sizes vary without a documented baseline, and element sizing has grown organically without a reference spec. This audit documents the current state so that follow-on implementation issues have a concrete sizing baseline to work from.

## What Changes

- A new capability `panel-content-sizing` is introduced as a spec documenting the audit findings: current padding values, font sizes, and element dimensions for each panel type, plus identified gaps where content feels undersized.
- No runtime code changes in this task — the output is a spec consumed by subsequent implementation issues.

## Capabilities

### New Capabilities
- `panel-content-sizing`: Documents current padding, font sizes, and element sizing for each panel type; identifies where content feels sparse or undersized relative to the panel container; provides a sizing baseline spec for implementation issues.

### Modified Capabilities
<!-- None — this is a documentation/audit task with no requirement changes to existing capabilities. -->

## Impact

- Produces `openspec/specs/panel-content-sizing/spec.md` as the sizing baseline.
- No API, backend, or schema changes.
- Affects: all panel type frontend components (`frontend/src/components/panels/`).

## Non-goals

- Implementing any sizing changes — that is for follow-on tickets.
- Defining a new design token system — existing tokens are audited as-is.
