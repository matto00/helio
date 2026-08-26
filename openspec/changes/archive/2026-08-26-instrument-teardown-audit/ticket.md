# HEL-838: Instrument WorkspaceTeardownService.teardown into the audit store

## Description

HEL-477 instrumented every named single-resource mutation into the audit store, but `WorkspaceTeardownService` was explicitly out of its scope and has zero audit references today.

Verified against `main` (85aa8ec2): `backend/src/main/scala/com/helio/services/workspace/WorkspaceTeardownService.scala` is 80 lines and `grep -i audit` returns nothing.

It backs `POST /api/workspace/teardown` (built by HEL-366) — a tag-scoped bulk delete that removes data sources, pipelines and data types in a single transaction via `WorkspaceTeardownRepository.teardown`, then best-effort deletes the backing files from disk.

This is the highest-blast-radius mutation in the route tree and the only one that can destroy many resources at once, which makes it simultaneously the least-audited and most consequential path.

Surfaced by HEL-477's `route-audit-enumeration.md` (archived at `openspec/changes/archive/2026-08-26-instrument-audit-mutations/`), which walked every mutating route and flagged this as a tracked gap rather than fixing it in-scope.

## What changes

Follow the established pattern from `DashboardService`: a private fire-and-forget `audit(...)` helper with `auditService: AuditService = null` defaulted in the constructor.

Two things already line up:

* `WorkspaceTeardownService.teardown` already receives `user: AuthenticatedUser`, which post-HEL-483 carries `tokenId` and `source` — actor attribution needs no new plumbing.
* `TeardownOutcome` already carries the right metadata: `sourcesDeleted`, `pipelinesDeleted`, `typesDeleted`, `conflicts`, `committed`, `blocked`.

Wire `auditService` through `ApiRoutes` where `workspaceTeardownServiceOpt` is constructed (`ApiRoutes.scala` ~line 422).

## Design question to settle in the proposal

The `dryRun` and `blocked` paths delete nothing, so they should not write a row that implies destruction. Recommendation: record only the committed case, with the deletion counts in metadata making the row self-describing. State the decision explicitly either way rather than leaving it implicit.

Also decide: does a partial file-cleanup failure (`cleanupFiles` is best-effort, post-commit, never fails the committed teardown) change what is recorded?

## Acceptance criteria

- [ ] A committed teardown writes exactly one audit row, with correct action, resourceType, actor id, acting token id and source
- [ ] That row's metadata carries the deletion counts (sourcesDeleted, pipelinesDeleted, typesDeleted)
- [ ] An integration test asserts no audit row is written for a dryRun teardown
- [ ] An integration test asserts no audit row is written for a blocked teardown
- [ ] The dry-run/blocked recording decision is documented explicitly in the change's design.md
- [ ] `auditService` is wired through `ApiRoutes` at the `workspaceTeardownServiceOpt` construction site, and the null-default no-op path remains intact for existing constructions

## Scope discipline

HEL-840 separately covers DataSourceService.refresh, SourceService.refresh, and AuthService.completeOAuth's missing auth.register. Do NOT absorb those. Do not regress them.
