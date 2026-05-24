# HEL-278 — Restrict pipeline JoinStep right-source to caller-owned or shared data sources

## Context

Surfaced during HEL-265 CS5 (final cleanup cycle of the ACL push-down chain).

`JoinStep.evaluate` and `SparkJobSubmitter` currently use `dataSourceRepo.findByIdInternal` to resolve the right-side data source of a join. This is a documented privileged path — it bypasses the owner check intentionally so a pipeline that was authored when the join source was accessible continues to evaluate even if the source has since been moved out of the caller's reach.

That bypass is **too permissive for v1**: it means User A can author a pipeline that joins against User B's data source as long as User A knows User B's source ID (which they can guess if they ever had access to it).

## Why this didn't block HEL-265

HEL-265 was about pushing ACL down to the repo layer for the primary owner-or-sharing check. The JoinStep cross-user behavior is a separate semantic question (sharing across users for pipeline composition), not an enforcement bug. Explicitly noted as out-of-scope in design.md and called out in CS5 cleanup.

## Scope

* Pre-flight ACL: when a pipeline step is **created or updated** with a JoinStep, validate the right `dataSourceId` is owned by the caller (via `findByIdOwned`) or shared via a future `resource_permissions` grant on data sources. Reject with 404 otherwise.
* Runtime resolution: keep `findByIdInternal` at evaluation time (the pipeline owner authored this step, so the join target was acceptable at authoring time) — OR switch to a snapshot model where the join target source ID is captured at authoring and recorded immutably in the step config.
* Decide which: pre-flight + runtime internal, or pre-flight + snapshot. Doc the choice.

## Acceptance Criteria

1. New step creation / update with a JoinStep whose right-source is not caller-accessible returns 404
2. Existing pipelines that reference a now-unreachable source still evaluate without erroring (graceful degradation OR a clear "right source no longer accessible" error)
3. Test: cross-user pipeline create with JoinStep against another user's source → 404
4. Test: pipeline owner creates JoinStep with their own source → 200, evaluation proceeds normally
5. Coordinate with HEL-272 (RLS) — once RLS is on, this validation is also enforced at the DB layer for defense-in-depth

## Related

* Parent chain: HEL-265 (now closed)
* Defense-in-depth follow-up: HEL-272 (RLS epic)
* Adjacent feature: pipeline sharing (separate ticket — pipelines have no `resource_permissions` analog today)

## Important Constraints

- This is authorized security-hardening work. Do NOT modify AuthService (security-sensitive, off-limits).
- Structural refactors must be behavior-preserving; trivial bugs fixed inline, non-trivial bugs spun off as separate tickets.
- No inline fully-qualified names (hard-fails the pre-commit hook).
