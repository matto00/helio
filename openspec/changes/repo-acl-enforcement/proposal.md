# Proposal — Push ACL enforcement down to the repository / SQL layer

## Summary

Today every ACL'd resource is gated by two layers in front of the repository:

1. `AclDirective` (route boundary) — resolves the resource owner and 403s mismatches
2. `AccessChecker` + per-service `if (resource.ownerId != user.id) Forbidden` (service layer)

Both are easy to forget. The audit in cycle 1 confirmed multiple omissions
already exist in production code (HEL-256, HEL-268, and the new findings
documented in `executor-report-1.md`). The most consequential: **the entire
Pipeline surface — `PipelineService`, `PipelineRunService`, `PipelineStepRoutes`,
`PipelineRunSubmit/Status/Stream/HistoryRoutes` — has no ownership concept at
all**. Pipelines, pipeline_steps, and pipeline_runs have no `owner_id` column,
no `AclDirective` wrapper, and no service-layer check. Any authenticated user
can list, read, run, or delete any other user's pipeline today.

The fix is to push ACL into the repository layer's public read API so the SQL
itself enforces ownership:

- Reading repos take an explicit `user: AuthenticatedUser` argument and emit
  `WHERE owner_id = :user OR EXISTS (resource_permissions ...)` in the query
- The handful of privileged background paths that genuinely need cross-user
  reads (Spark joins, pipeline-run execution under the system user) call a
  separate `findByIdInternal` variant whose name signals the danger
- The Scala-side `if (ownerId != user.id) Forbidden` check disappears from
  every service method that uses an ACL'd repo

## Why now

- HEL-236 CS2c (Panel + DataSource sealed-trait ADTs) is merged. Repo
  signatures are about as quiet as they get
- HEL-256 cycle 1b documented the `GET /api/types/:id` cross-user leak;
  HEL-268 captured the same; both close naturally here
- The audit surfaced that pipelines are wide open — this is a real, present-day
  security gap, not a theoretical hardening pass
- Touching every repo's signature is a one-shot disruption — better as one
  focused effort than ten small patches

## What changes

1. **Repository public reads accept caller identity.** `findById(id, user)`,
   `findAll(user)`, and equivalents. Returns `None` for rows the caller can't
   see (existence and authorization indistinguishable at the API).
2. **SQL enforces ACL.** Each query gets either an `owner_id = :user` filter
   (owned-only) or `owner_id = :user OR EXISTS (resource_permissions ...)`
   (owned + shared), driven by per-callsite analysis (see design.md Q1).
3. **Privileged background reads use `findByIdInternal`.** Currently three:
   `JoinStep.evaluate` (join's right-side source), `SparkJobSubmitter.runStep`
   (same), `PipelineRunService.submit` reading the source for execution. These
   become `*Internal` methods documented to bypass ACL because the parent
   pipeline's ACL gated entry.
4. **Pipeline tables gain `owner_id`.** New Flyway migration adds the column
   (NOT NULL DEFAULT system user, like V10), backfills, indexes, and seeds the
   `ResourceTypeRegistry`. PipelineService + PipelineRunService take + thread
   the user through every method.
5. **Service-layer ACL checks deleted.** The `if (existing.ownerId != user.id)
   Left(Forbidden)` pattern goes away from DashboardService, PanelService
   (batchUpdate), SourceService (every method) — repo returns `None` already
   for cross-user reads, so the existing `None ⇒ NotFound` branch covers it.
6. **Per-repo regression tests.** Every ACL'd repo gets a "wrong user gets
   `None`" test; every route that previously leaked gets a route-level
   regression test (notably `GET /api/types/:id`, `GET /api/types/:id/rows`,
   the full pipeline surface).

## Why not PostgreSQL RLS

RLS is defense-in-depth and we keep it as a deferred follow-up — see design.md
Q2 for the trade-off analysis. The short version: HikariCP's connection
pooling means we'd have to set + reset a session variable on every connection
acquisition, which is brittle and hard to test. App-layer JOINs in Slick
compose cleanly with the existing query patterns and are obvious to read.

## Out of scope

- New ACL features (roles, scopes, hierarchies)
- Frontend changes (response shapes unchanged for owners)
- Sharing UX changes (HEL-36 already done; we preserve its semantics)
- HEL-266 / HEL-267 / HEL-270 (separate tickets)
- RLS layer (deferred follow-up)
- Adding owner columns to anything that already has one (V10/V14/V15 covered
  the listed 7 minus the three pipeline tables; this change adds those)

## Sub-PR strategy (summary; full plan in design.md Q3)

Five sub-PRs (PR/CS1 … PR/CS5):

1. **CS1 — Pipeline owner_id foundation** (new Flyway migration + registry +
   Pipeline domain field + repo signatures). No callsite changes yet; tests
   only confirm the migration runs.
2. **CS2 — Pipeline ACL enforcement** (PipelineService, PipelineRunService,
   PipelineStepRepository signatures + service-level user threading + the
   ACL'd reads). This closes the largest current security gap. Standalone PR.
3. **CS3 — DataType & DataSource repo ACL enforcement** (delete the unscoped
   `findById` overload; collapse `dataTypeRepo.findById(id)` + `findById(id, ownerId)`
   into one safe API; service-layer `Forbidden` checks deleted).
4. **CS4 — Dashboard & Panel repo ACL enforcement** (the largest behavior
   delta because of public-dashboard sharing semantics; the JOIN pattern is
   non-trivial here, but smaller in callsite count than CS3).
5. **CS5 — Cleanup + cross-cutting** (`*Internal` naming pass; documentation
   of every privileged callsite; remove any now-dead Scala-side ACL helpers;
   spec sync).

Each PR atomically updates the repo signature plus every consumer. No
transitional `findById` / `findByIdScoped` overload — see design.md Q4.
