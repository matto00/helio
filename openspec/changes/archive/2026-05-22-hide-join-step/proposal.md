# hide-join-step — Proposal

## Problem
The step-op picker in the pipeline detail page lists "Join tables" as an
available operation. Join is not yet fully implemented (backend is stubbed),
so showing it causes user confusion.

## Solution
Remove `join` from the `OP_TYPES` array that drives the picker dropdown.
The type definition, backend code, and wire types all stay in place so
existing (seeded/test) pipelines with join steps continue to load and render
without errors.

## Scope
- Frontend only: `frontend/src/features/pipelines/state/stepNarrowing.ts`
- No schema changes, no backend changes
- HEL-278 (ACL fix for JoinStep.rightDataSourceId) is a separate ticket
  and is not touched here

## Risk
Low. The only observable change is the absence of "Join tables" in the picker.
Existing join steps render via the StepCard generic fallback branch (already
in place) and are unaffected.
