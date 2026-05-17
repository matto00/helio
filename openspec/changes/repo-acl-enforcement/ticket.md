# Ticket Context — HEL-265

**Linear**: https://linear.app/helioapp/issue/HEL-265
**Title**: Push ACL enforcement down to repository / SQL layer
**Priority**: Medium
**Created**: 2026-05-13 from reviewer feedback on HEL-236 CS2b PR #148
**Absorbs**: HEL-268 (Canceled — closed with pointer to this ticket)

## Goal

Push ACL into the repository / SQL layer so it can't be forgotten by a service method. Two complementary moves per the originating ticket:

1. **Repository signatures accept caller identity.** `dashboardRepo.findById(id, user)` returns `None` if the user has no entry in `resource_permissions` for the row (and isn't the owner). The user-less variant is removed from the public API; only privileged background jobs use a `findByIdInternal` variant scoped to `infrastructure/`.
2. **The SQL query enforces ACL via JOIN/EXISTS.** `WHERE owner_id = :user OR EXISTS (SELECT 1 FROM resource_permissions p WHERE p.resource_type='dashboard' AND p.resource_id=dashboards.id AND p.grantee_id=:user)`. DB never returns rows the caller isn't authorized to see.

## Why now

- HEL-236 CS2c (Panel + DataSource sealed-trait ADTs) is now ✅ merged — the suggested timing in the ticket
- HEL-242 + HEL-256 investigations both surfaced ACL asymmetry (HEL-256 cycle 1b found `GET /api/types/:id` returns cross-user DTs; HEL-242 found analogous asymmetry on `/api/types/:id/rows`)
- HEL-268 (specific `GET /api/types/:id` leak) Canceled — absorbed here
- Touching every repo's signature is a one-shot disruption — better as one focused effort than ten small patches

## Scope (from originating ticket)

**Repos**: `DashboardRepository`, `PanelRepository`, `DataSourceRepository`, `DataTypeRepository`, `PipelineRepository`, `PipelineRunRepository`, `PipelineStepRepository`

**Services**: every service method that currently does the Scala-side `if (resource.ownerId != user.id) Forbidden` check (most of CS2b's services)

**Tests**: "wrong user cannot see another user's resource" test for every repo

## Pre-existing ACL infrastructure (verified, all DONE)

- HEL-35 — resource ownership model (`owner_id` columns added Flyway V10/V14/V15)
- HEL-36 — sharing + per-resource permissions (`resource_permissions` table, V16)
- HEL-37 — `authorizeResource` Akka directive (now `AclDirective` in the codebase)
- HEL-40 — generic ResourceType registry (the directive dispatches via a string key + ownership resolver)
- HEL-70 — per-user isolation on Data Sources + Type Registry (added `findById(id, ownerId)` overloads, still inconsistently used per HEL-256 / HEL-268 findings)
- HEL-130 — `owner_id` indexes (V17)

This ticket is the "harden the existing infrastructure so it can't be bypassed" pass on top of those foundations.

## Open design questions (settle in cycle 1)

### Q1 — Owned-only vs owned+shared semantics per call site

The SQL pattern in the originating ticket includes BOTH (`owner_id = :user OR EXISTS (resource_permissions ...)`), but real call sites differ:
- "My dashboards" sidebar — likely owned-only
- "All dashboards I can see" landing page / shared dashboards UI — owned + shared
- Pipeline run that needs to read a source for execution — owned-only (running someone else's source via your pipeline is a hole)
- Panel binding to a DataType — currently owned-only via `resolveBindingsForRead` scrub

Resolution path: enumerate every callsite; for each, pick `findById(id, user)` (owned + shared) vs `findByIdOwned(id, user)` (owned only) vs `findByIdInternal(id)` (privileged background). Document the per-callsite choice in design.md.

### Q2 — Application-layer JOIN vs PostgreSQL RLS

Originating ticket recommends application-layer JOIN (Slick query rewriting). PostgreSQL has Row Level Security (RLS) policies that enforce at the DB engine level via session variables.

Trade-offs:
- **App-layer JOIN**: explicit in Scala/Slick code; easy to read and debug; works with the existing migration/test patterns; doesn't require setting session vars per request
- **PostgreSQL RLS**: defense-in-depth (even raw SQL queries can't bypass); zero risk of forgetting the JOIN in a new method; requires setting `helio.current_user_id` session var on every connection acquisition; harder to debug; harder to test

Resolution path: recommend app-layer JOIN per the originating ticket, but document the RLS trade-off so future-us knows why we chose. If we want both (belt + suspenders), schedule RLS as a follow-up.

### Q3 — Sub-PR split

Likely too much for one PR — touching 7 repos + every consuming service + new tests per repo + Flyway migration (if any). Cycle 1's design.md should propose a sub-PR plan:
- Option A: per-repo sub-PRs (`CS1=Dashboard`, `CS2=Panel`, ...) — small, reviewable, but high context-switching
- Option B: thematic sub-PRs (`CS1=user-facing-resource repos`, `CS2=pipeline-internal repos`, `CS3=internal/find-without-user audit + cleanup`)
- Option C: one big PR — high review burden, but atomic correctness

### Q4 — Backward-compat strategy

How to land without breaking every consumer simultaneously?
- Option A: introduce `findById(id, user)` alongside existing `findById(id)`; deprecate the old; migrate callers in cycle 2+; delete `findById(id)` from public API in final cycle
- Option B: rename `findById(id)` to `findByIdInternal(id)` and force callers to either migrate or explicitly opt into the internal variant
- Option C: change signatures atomically per repo with callsite updates in the same commit (no transitional state)

## Acceptance criteria

1. Every ACL'd repo's public `findById` / `findAll` / equivalent reads accept caller identity and enforce ACL in SQL
2. The Scala-side `if (resource.ownerId != user.id) Forbidden` pattern is gone from every service method that uses an ACL'd repo
3. Existing `dataTypeRepo.findById(id)` (unscoped overload) either deleted or moved to `*Internal` with documented callers
4. For every repo: a regression test asserts "wrong user gets None (not the resource)"
5. The cross-user `GET /api/types/:id` leak (was HEL-268) closes naturally — verified by a route-level test
6. Public dashboard / panel sharing (HEL-36 semantics) continues to work — owner-vs-shared SQL covers the existing share paths
7. No behavior changes for owners reading their own resources
8. All gates pass: sbt test, lint, format, jest, build, scala-quality, openspec validate
9. Performance: SQL plan check that the new JOIN/EXISTS doesn't blow up — the `owner_id` indexes (HEL-130) should keep us O(log n)

## Patterns inherited

- Behavior-preserving structural refactor discipline ([[feedback-refactor-discipline]]) — owners' read paths unchanged in behavior; only authorization semantics on cross-user reads change
- File-size budgets unchanged
- No-inline-FQN pre-commit hook
- Atomic commits per logical unit (repo conversion + its consumers in one commit)
- [[feedback-widen-bug-repro]] applies to any security regression hunting
- Verify before changing (cycle 1 = investigation + design; cycle 2+ = implementation)

## Out of scope

- New ACL features (e.g. role refinements, scopes, hierarchies)
- Frontend changes (the UI doesn't change; only what the API returns)
- Sharing UX changes
- HEL-266 (cross-tab invalidation), HEL-267 (dev-DB drift), HEL-270 (Type Registry sidebar UX) — separate tickets
- PostgreSQL RLS layer — design.md should recommend deferred follow-up if app-layer is chosen
- Adding new owner_id columns (everything that needs one already has one per HEL-35/HEL-70)

## Process

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-265`
- Branch: `feature/repo-acl-enforcement/HEL-265`
- Dev ports: 5414 (frontend), 8321 (backend)
- linear-executor + linear-evaluator at opus model
- Commits prefixed `HEL-265 [cycle N]: <summary>`
- STOP after each cycle's evaluation passes; orchestrator-relay confirms before next cycle
- Sub-PR splitting decision lives in cycle 1's design.md

## Escalation policy

- If cycle 1 surfaces that app-layer JOIN is too invasive (e.g. Slick patterns don't compose cleanly across owner-OR-shared), surface as BLOCKER with the RLS-or-hybrid alternative
- If cycle 1 finds an ACL hole in a code path NOT in the listed repos (e.g. `Run`, `Step`, or anything new), surface for scope expansion
- If sub-PR strategy doesn't survive contact with reality (e.g. one repo's conversion requires every consumer's update simultaneously, breaking the atomic split), surface for re-scoping
