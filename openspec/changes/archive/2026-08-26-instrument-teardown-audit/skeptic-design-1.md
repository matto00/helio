## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Every claim below was checked against the live tree in the worktree, not against the prose.

- **Service shape / `user` plumbing** — `backend/src/main/scala/com/helio/services/workspace/WorkspaceTeardownService.scala` is 80 lines, takes `(teardownRepo, fileSystem)`, `teardown(req, user: AuthenticatedUser)`. `grep -i audit` returns nothing. Matches ticket + design.md Context.
- **Decision 1 (only committed rows) — CONFIRMED against the repository.**
  `backend/src/main/scala/com/helio/infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala:70-95`:
  `committed <- if (!clean || dryRun) DBIO.successful(false) else …map(_ => true)`, and
  `deletedSources = if (committed) … else Vector.empty`. So `committed = false` for both dryRun
  and blocked, exactly as design.md asserts. The decision is additionally *strengthened* by a fact
  design.md does not mention: on a **clean dry run** the counts are non-zero
  (`sourcesDeleted = if (clean) taggedSources.size else 0`, repo `:85-87`) — a dry-run row would
  therefore carry destruction counts for a destruction that never happened. Gating on `committed`
  is the right call.
- **Decision 2 (one row per call) — precedent CONFIRMED verbatim.** HEL-477 design.md Decision 7
  (`openspec/changes/archive/2026-08-26-instrument-audit-mutations/design.md`) states the
  "one row per actor-initiated API call" principle for `dashboard.duplicate` and cascade deletes.
  I also read HEL-477 **Decision 10**, which *narrows* D7 for apply/undo engines that fan out
  through already-instrumented per-resource services. That carve-out does **not** apply here:
  teardown issues raw Slick `.delete` statements inside one transaction
  (repo `:74-80`) and never routes through `DataSourceService`/`PipelineService`/`DataTypeService`,
  so there are no per-resource rows to preserve. D7 governs. Decision 2 is sound.
- **Decision 3 (cleanupFiles irrelevant) — CONFIRMED.** `WorkspaceTeardownService.scala:51-54`:
  `cleanupFiles` runs post-`flatMap` on the outcome, `.recover { case _ => () }` per file, and is
  a no-op when `deletedSources` is empty.
- **Decision 4 (new `workspace` resource_type) — CONFIRMED safe.** `V91__audit_events.sql`:
  `resource_type TEXT NOT NULL`, `resource_id TEXT NULL`, no CHECK/enum (only `source` is
  constrained). `AuditEventRoutes.scala:47` takes `resourceType` as a free-form optional query
  param; `frontend/src/features/audit/types/auditEvent.ts:18,29` types it as plain `string`. The
  design.md risk note ("verify HEL-488's filter at execution time") can be closed now — it is
  generic, no follow-up needed.
- **`audit(...)` helper signature** — `DashboardService.scala:45-47` hardcodes `resourceType`
  inside the helper, so tasks.md 1.3's 4-arg `audit(action, resourceId, user, metadata)` call
  shape is correct, not a missing parameter.
- **ApiRoutes wiring site** — `ApiRoutes.scala:422-423` constructs
  `workspaceTeardownServiceOpt` via `Option(dbContext).map(...)`; `auditService` is an in-scope
  `private val` at `:182` (`… .orNull`) already threaded into ~15 sibling services. Task 1.4 is
  mechanically straightforward and the null-default contract is real.
- **Test infrastructure exists** — `AuditTestFixture.CapturingAuditEventRepository`, and
  `WorkspaceTeardownServiceSpec` is a real dual-pool embedded-Postgres spec able to produce all
  three outcomes.

The four Decisions are individually sound and each survived checking against the source. What
does **not** hold up is the test plan that the ticket's acceptance criteria actually rest on.

### Verdict: REFUTE

### Change Requests

1. **tasks.md 2.2 / 2.3 (ACs 3 and 4) will pass vacuously as written — specify the barrier.**
   `AuditService.record` defers the append onto the execution context
   (`AuditService.scala:44`, `Future(auditEventRepo.append(event)).flatten`) and every call site is
   fire-and-forget. The existing harness knows this: `AuditMutationInstrumentationSpec.scala:204-217`
   documents it and polls via `eventuallyAuditRows`, but that helper only exists for the
   *positive* direction — it polls **until a row appears**. There is no negative counterpart, and
   tasks.md 2.2/2.3 give the executor no guidance. A naive
   `allAuditRows() shouldBe empty` immediately after the teardown response passes whether or not
   the code is correct, because the row simply may not have landed yet. That makes two of the six
   acceptance criteria unfalsifiable. Add to tasks.md (and note in design.md) an explicit barrier
   technique, e.g.: after the dry-run/blocked call, issue a *second, committed* teardown (or any
   already-instrumented mutation), `eventuallyAuditRows` on **that** row to prove the audit write
   path has drained, and only then assert zero `workspace.teardown` rows for the dry-run/blocked
   tag. State the chosen technique in tasks.md so the evaluator can check it was used.

2. **Nothing in tasks.md binds task 1.4 (the `ApiRoutes` wiring, AC 6) to a test.** Tasks 2.1-2.3
   say "integration test" without naming a host spec. If the executor puts them in
   `WorkspaceTeardownServiceSpec` — the natural home, since it already builds the service directly
   — all three pass with a hand-constructed `new WorkspaceTeardownService(repo, fs, capturingAudit)`
   even if `ApiRoutes.scala:422` was never touched. And the route-level spec cannot absorb them
   as-is: I grepped `AuditMutationInstrumentationSpec.scala` for `workspace|teardown` and got **zero
   matches** — `POST /api/workspace/teardown` is not exercised there today, so mounting it is real
   work that must be planned, not assumed. Name the host spec in tasks.md, and make at least the
   committed case (2.1) go through the real route → `ApiRoutes`-constructed service → embedded
   audit repo chain, so AC 6 has evidence bound to the wiring rather than to a test-local
   constructor call.

3. **Resolve the `committed`-with-zero-deletions ambiguity in specs/.../spec.md.** The spec's first
   requirement reads "that commits — i.e. **actually deletes** tagged data sources, pipelines, and
   data types". But a teardown of a tag matching nothing is `clean = true, dryRun = false` and so
   yields `committed = true` with all three counts at `0` (repo `:70-88`) — it commits an empty
   transaction. As written, an implementer could reasonably gate the audit call on
   `counts > 0` instead of on `outcome.committed`, and an evaluator could reasonably flag either
   reading as wrong. Pick one explicitly (recommend: gate strictly on `outcome.committed`, so a
   no-op teardown still records the actor-initiated destructive call with zero counts), reword the
   requirement's "i.e." clause to match, and say so in design.md Decision 1.

### Non-blocking notes

- Design.md's Decision 1 cites `WorkspaceTeardownRepository.scala:69-92` without a package path;
  the file is under `infrastructure/persistence/workspace/`, not the `services/workspace/` path
  the Context paragraph establishes just above it. Worth disambiguating so a later reader does not
  chase a nonexistent file (I did).
- Consider having Decision 2 cite HEL-477 Decision **10** as well as 7, explicitly recording *why*
  the apply/undo carve-out does not reach teardown (raw Slick deletes, no instrumented per-resource
  service in the path). It is the obvious counter-argument to Decision 2 and it is cheap to
  pre-empt.
- Design.md's stated risk about `workspace` having "no prior audit-query-UI filter entry" is
  already resolved — see the Decision 4 evidence above. It can be struck rather than carried into
  execution as a thing to verify.
- The worktree's `scripts/concertino/` contains only 5 of the repo's 20 scripts (no
  `next-report-number.sh`, `persist-evidence.sh`, or `emit-event.sh`); I used the main checkout's
  copies. Not a blocker for this gate, but the executor/evaluator should expect the same gap.
