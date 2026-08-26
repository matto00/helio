## Context

`WorkspaceTeardownService.teardown` (80 lines, `backend/src/main/scala/com/helio/services/workspace/WorkspaceTeardownService.scala`)
wraps `WorkspaceTeardownRepository.teardown`, which runs the whole tag-scoped bulk delete inside
one DB transaction and returns a `TeardownOutcome(blocked, conflicts, committed, sourcesDeleted,
pipelinesDeleted, typesDeleted, deletedSources)`. `teardown` already receives `user:
AuthenticatedUser` (HEL-483: carries `tokenId`/`source`). After the transaction, `cleanupFiles`
best-effort deletes backing files from disk, `.recover { case _ => () }`, and never fails the
already-committed teardown. `ApiRoutes.scala:422-423` constructs the service via
`workspaceTeardownServiceOpt`. The established audit pattern (`DashboardService.scala:35-52`) is a
private `audit(...)` helper, no-op when `auditService` is `null`.

## Goals / Non-Goals

**Goals:**
- Emit exactly one audit event per committed teardown, self-describing via metadata.
- Zero audit rows for dry-run or blocked calls, since neither destroys anything.
- Wire `auditService` through `ApiRoutes` at the existing construction site without disturbing the
  `Option(dbContext).map(...)` nullable-optional wiring.

**Non-Goals:**
- `DataSourceService.refresh`, `SourceService.refresh`, `AuthService.completeOAuth` — HEL-840.
- Per-deleted-resource audit rows (one row per source/pipeline/type destroyed) — see Decision 1.

## Decisions

**Decision 1 — Record only the committed case; no row for dryRun or blocked. Gate strictly on
`outcome.committed`, not on nonzero counts.**
A `dryRun` call and a `blocked` call both delete nothing (`TeardownOutcome.committed = false` in
both cases per `infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala:70-95`;
`deletedSources` is empty in both). A row for either would assert a destruction that never
happened — the opposite of what an audit trail is for. This is stronger than it first appears: on
a *clean dry run* the deletion counts are still computed and non-zero
(`sourcesDeleted = if (clean) taggedSources.size else 0`, same file `:85-87`, evaluated
independent of `dryRun`) — a dry-run row would carry counts describing a destruction that never
happened, not merely an empty/uninformative row. The committed row's `metadata`
(`sourcesDeleted`/`pipelinesDeleted`/`typesDeleted`) already makes it fully self-describing without
a companion "attempted but not committed" event.

The audit call gates strictly on `outcome.committed`, never on `counts > 0`. A teardown of a tag
matching zero resources is `clean = true, dryRun = false`, so `committed = true` with all three
counts at `0` — this still writes a `workspace.teardown` row, because the actor-initiated
destructive call genuinely ran (an empty transaction commit is still the actor's teardown request
executing, not a no-op the audit trail should hide). Gating on counts instead would silently drop
the audit trail for the (valid, if unusual) all-zero-match case; gating on `committed` needs no
extra conditional and is the simpler, correct rule.

**Decision 2 — One row per teardown call, not one per deleted resource (Decision 7 precedent;
Decision 10's apply/undo carve-out does not reach here).**
HEL-477 design.md Decision 7 established "one row per actor-initiated API call" for composite
mutations (`dashboard.duplicate`, cascade deletes) — the meaningful actor-initiated action is "tore
down tag X," not N independent resource deletions the actor never individually requested. Teardown
is the most composite mutation in the tree; the same reasoning applies with more force here. One
`workspace.teardown` event, `resource_id` = the tag, carries the three deletion counts in
`metadata` rather than fanning out into `sourcesDeleted`× `data_source.delete` +
`pipelinesDeleted`× `pipeline.delete` + `typesDeleted`× `data_type.delete` rows.

HEL-477 design.md Decision 10 narrows D7 for apply/undo engines that fan out through
already-*instrumented* per-resource services (`PatchSetApplyForward` dispatching to
`panelService`/`dashboardService`/etc.), where one row per underlying instrumented call is correct
because those calls are independently reachable, already-audited actions. That carve-out does
**not** apply to `WorkspaceTeardownRepository.teardown`: it issues raw Slick `.delete` statements
directly inside one transaction and never routes through `DataSourceService`/`PipelineService`/
`DataTypeService`, so there are no already-instrumented per-resource calls whose rows would need
preserving. D7 governs without qualification.

**Decision 3 — A partial `cleanupFiles` failure does not change what is recorded.**
`cleanupFiles` runs strictly after the DB transaction commits, is best-effort, and already
swallows every per-file failure via `.recover { case _ => () }` — the committed teardown's outcome
(what was *actually deleted from the database*, which is the durable, authoritative state change)
is unaffected by whether a stray file on disk failed to delete afterward. The audit event
describes the transaction's outcome, not the file-cleanup side effect; a leftover orphaned file is
an operational cleanup concern, not a fact the audit trail needs to assert or qualify. The `audit`
call fires once, unconditionally, on a committed outcome, before or independent of
`cleanupFiles`'s own (already-swallowed) success/failure.

**Decision 4 — Action/resourceType naming.** `workspace.teardown` / `resource_type = "workspace"`,
following the `<resource>.<verb>` convention (`dashboard.duplicate`, `panel.batch_create`);
`workspace` is a new `resource_type` value (the tag is not an existing dashboard/panel/pipeline id,
so it does not fit any prior resource_type).

## Test plan (skeptic-design-1 round 1)

- **Negative-assertion barrier (dryRun/blocked write no row).** `AuditService.record` is
  fire-and-forget (`AuditService.scala:44`, deferred `Future`), so asserting "no row" immediately
  after the dry-run/blocked call is unfalsifiable — the row may simply not have landed yet, whether
  or not the code is correct. Tests 2.2/2.3 MUST use a barrier: after the dry-run/blocked call,
  issue a second, real (committed) mutation — e.g. a committed teardown of a different tag, or any
  already-instrumented call reachable in the same spec — and `eventuallyAuditRows` (the existing
  helper in `AuditMutationInstrumentationSpec.scala:209`) on *that* row first, to prove the audit
  write path has drained, before asserting zero `workspace.teardown` rows for the dry-run/blocked
  tag.
- **Host specs, named explicitly.** Test 2.1 (committed case, AC 1/2) and the `ApiRoutes` wiring
  assertion (AC 6) live in `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
  — the existing route-level spec that drives real HTTP requests through the actual
  `ApiRoutes`-constructed service tree into the embedded audit repo, so a regression at the
  `workspaceTeardownServiceOpt` construction site (task 1.4) is caught by the same test that
  proves the committed row exists; a test-local `new WorkspaceTeardownService(repo, fs,
  capturingAudit)` would not catch that regression. Tests 2.2/2.3 (dryRun/blocked negative
  assertions) may live in either `AuditMutationInstrumentationSpec.scala` (preferred, for the same
  route-level reason) or `WorkspaceTeardownServiceSpec.scala` if the barrier technique above is
  used there instead — either way, the chosen host must be stated in tasks.md so the evaluator can
  verify it was used.

## Risks / Trade-offs

- A future teardown call that fails mid-transaction and rolls back never reaches `committed =
  true`, so correctly writes no row — no change needed, already covered by gating on `committed`.
- `workspace` as a new resource_type needed no code change to support in the audit-query
  API/UI — verified: `V91__audit_events.sql`'s `resource_type` column has no CHECK/enum,
  `AuditEventRoutes.scala:47` takes it as a free-form optional query param, and
  `frontend/src/features/audit/types/auditEvent.ts` types it as plain `string` — resolved during
  design-gate review, no follow-up needed.
