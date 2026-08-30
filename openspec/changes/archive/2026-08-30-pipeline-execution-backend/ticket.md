# HEL-330: Extract a PipelineExecutionBackend abstraction (behavior-preserving refactor)

## Description
> Row 0a of the Pipelines & Outputs remodel (HEL-903) — the first ticket a batch agent should pick up. Behaviour-preserving as written; P1.2 (HEL-905) lands the engine tree-walk behind this abstraction. Spec: `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`.

Sub-issue of HEL-238. Pure structural refactor — behavior-preserving, no new runtime path, no wire change.

## Scope
- Introduce a `PipelineExecutionBackend` trait (submit run -> status -> read result) that the run service depends on.
- Adapt the existing in-process engine / `SparkJobSubmitter` to sit behind it as the sole implementation, wired by default.
- No change to routing, results, or observed behavior - this only creates the seam a second implementation plugs into.

## Acceptance
- All existing pipeline/run tests pass unchanged; no behavioral or wire diff.
- The trait cleanly admits a second impl (verified by the DataprocServerlessSubmitter sub-issue building on it).
- Follows CONTRIBUTING refactor discipline: structural change stays behavior-preserving; any bug found is a spinoff, not folded in.

## Dependencies
None - foundation. Blocks the DataprocServerlessSubmitter and tiered-dispatch sub-issues.

## Design spec authority
`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` on main wins wherever it disagrees with this ticket text.
