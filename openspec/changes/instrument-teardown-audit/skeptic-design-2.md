## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold re-derivation from the tree; round-1's three change requests checked for *closure*, not wording.

- **CR1 (unfalsifiable negative assertions) — CLOSED.** design.md now has a "Test plan" section
  naming the barrier explicitly, and tasks.md 2.2/2.3 restate it as an instruction ("issue a second,
  committed mutation … `eventuallyAuditRows` on that row … THEN assert zero rows"). Ground truth
  backing it: `AuditService.scala:47` is `Future(auditEventRepo.append(event)).flatten` — deferred,
  fire-and-forget, exactly as design.md characterizes it; `eventuallyAuditRows` really does exist at
  `AuditMutationInstrumentationSpec.scala:209` and polls up to 2s for a row to *appear* (positive
  direction only), so the barrier is the right compensating technique and the helper cited is real.
  The evaluator now has a checkable artifact ("was a barrier mutation used?").
- **CR2 (nothing binds task 1.4 / AC 6 to a test) — CLOSED.** tasks.md §2 now has an explicit
  "Host spec:" header naming `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`,
  states outright that `POST /api/workspace/teardown` is *not* currently mounted there, and makes the
  mounting work part of 2.1 rather than an assumption. Verified the binding is real and achievable:
  that spec builds `new ApiRoutes(...)` for real (`:141-190`), with the embedded-Postgres
  `auditEventRepo`; it passes **no** `dbContext`, and `ApiRoutes.scala:423` gates
  `workspaceTeardownServiceOpt` on `Option(dbContext)`, so the route is currently unmounted there —
  the task's claim is accurate, not hand-waved. The fixture is cheap: `beforeAll` already constructs
  `new DbContext(db, db)` (`:83`) as a local, so mounting is "hoist it to a field and pass it".
  Because the row is then produced by the `ApiRoutes`-constructed service, a regression at the 1.4
  wiring site fails 2.1 — which is precisely the binding AC 6 lacked.
- **CR3 (`committed`-with-zero-deletions ambiguity) — CLOSED.** spec.md's first requirement now
  defines commit as "the underlying transaction actually running (no blocking conflict, `dryRun`
  false), regardless of whether the tag matched zero, some, or all resources", the "i.e. actually
  deletes" wording is gone, and a dedicated scenario pins the all-zero-match case to one row with
  all counts `0`. design.md Decision 1 states the matching rule ("gates strictly on
  `outcome.committed`, never on `counts > 0`") and tasks.md 1.3 repeats it at the implementation
  site. This matches the repository: `WorkspaceTeardownRepository.scala:70-80` sets
  `committed = true` whenever `clean && !dryRun`, independent of set size.
- **Decisions still sound against source (re-checked, not carried over).** `committed = false` for
  both dryRun and blocked (`:70-72`); dry-run counts are gated on `clean`, not `committed`
  (`:84-87`) — so a dry-run row really would carry phantom destruction counts, as Decision 1 argues.
  `cleanupFiles` is post-transaction and `.recover { case _ => () }` per file
  (`WorkspaceTeardownService.scala:48-55`) — Decision 3 holds. `auditService` is an in-scope
  `private val` at `ApiRoutes.scala:182`, so task 1.4 is a one-argument change.
- **Blocked/committed fixtures are constructible through the route.** `tag: Option[String]` is a
  first-class field on the data-source create requests (`DataSourceProtocol.scala:36-101,184`), and
  the conflict predicates are ordinary differently-tagged/untagged dependents
  (`WorkspaceTeardownRepository.scala:56-60`), so both a clean tag and a blocked tag can be built
  via API calls the spec already knows how to make.

Round 1's non-blocking notes were also absorbed (repository path disambiguated, Decision 10
carve-out pre-empted, resolved `workspace` resource_type risk struck).

### Verdict: CONFIRM

### Non-blocking notes

- The barrier in 2.2/2.3 is a *drain* proof, not a hard happens-before: `AuditService.record`
  submits onto a pool, so an erroneously-recorded dry-run write and the barrier write are only
  submission-ordered, not completion-ordered. In practice this is the standard technique and is
  vastly stronger than an immediate assert; if the executor wants belt-and-braces, asserting zero
  rows *again* after the barrier row lands (or reusing the same tag ordering) costs nothing.
- Mounting the teardown route means passing `dbContext` into the shared `routesFor()` in
  `AuditMutationInstrumentationSpec`, which also mounts the other `Option(dbContext)`-gated route
  families (assistant, chat-access, beta-access, metrics) for every test in that spec. They live
  under distinct path prefixes so existing tests should be unaffected — but the full backend suite,
  not just `WorkspaceTeardownServiceSpec` (tasks.md 2.4), is the check that proves it.
- `scripts/concertino/` in this worktree still holds only a subset of the repo's scripts; I used the
  main checkout's copies for `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh`.
