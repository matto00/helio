## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Tooling note: `scripts/concertino/{next-report-number,persist-evidence,emit-event}.sh` do not
exist in this worktree (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
`start-servers.sh`, `lib/`, `README.md`). This is an absent-toolset condition, not a script
FAIL. Filename collision-safety was established by directly listing the change dir: it
contained `skeptic-design-1.md` and `skeptic-design-2.md` and no `skeptic-final-*`, so
`skeptic-final-1.md` is unused. No `verdict` event could be emitted; verdict is returned to
the orchestrator directly.

### What I verified (with evidence)

- **Diff is the whole change.** `git diff main...HEAD --stat` on commit `7cc18f7e`: 12 files,
  only 3 code files — `ApiRoutes.scala` (+4/-2), `WorkspaceTeardownService.scala` (+26),
  `AuditMutationInstrumentationSpec.scala` (+132). Rest is openspec artifacts. No frontend
  files → UI/design-judgment section not applicable.

- **AC1 (one row, correct attribution).** `WorkspaceTeardownService.scala:51-62`: a single
  `audit("workspace.teardown", Some(tag), user, …)` inside the one `teardownRepo.teardown(...)
  .flatMap`. One repo call per `teardown` invocation ⇒ at most one row per call, structurally.
  `audit(...)` forwards `user.id`, `user.tokenId`, `user.source` into
  `AuditService.record` (signature confirmed at `AuditService.scala:29-37`), resourceType
  `"workspace"`, resourceId `Some(tag)`.

- **Gating is strictly on `committed`, never on counts.** Call site is guarded by
  `if (outcome.committed)` — no count predicate anywhere. Verified the semantics at ground
  truth, not from the report: `WorkspaceTeardownRepository.scala:69-70`
  `committed <- if (!clean || dryRun) DBIO.successful(false) …`, i.e. `committed` is false
  exactly for blocked and dry-run, and true for a clean non-dry-run call even when the tag
  matched zero rows. The all-zero-match case is covered by its own passing test.

- **AC2 (counts in metadata).** `JsObject("sourcesDeleted"/"pipelinesDeleted"/"typesDeleted")`
  from `outcome`; asserted field-by-field in the committed test (1/0/1) and the empty-tag test
  (0/0/0).

- **AC3/AC4 (dryRun and blocked write zero rows) use a genuine barrier, not a naive
  assertion.** Both negative tests issue a *second, real committed* teardown against a fresh
  tag, poll for THAT row via `eventuallyAuditRows` (2s deadline, 25ms interval,
  `AuditMutationInstrumentationSpec.scala:218-226`), and only then assert
  `allAuditRows().count(dryRun/blocked tag) shouldBe 0`. Since the offending `record` call —
  had the gate been absent — would have been issued synchronously inside the earlier request
  (before its HTTP response returned) and the barrier's `record` is dispatched strictly later
  onto the same execution context and same DB, observing the barrier row establishes that the
  fire-and-forget path has drained past the earlier point. This is materially different from
  an immediate `count shouldBe 0`, which would be unfalsifiable. Tags are per-test UUIDs, so
  the `cleanDb()`-cannot-truncate-`audit_events` constraint (append-only trigger,
  spec lines 117-126) does not leak rows between tests.

- **ApiRoutes wiring is real and route-level.** `ApiRoutes.scala:424` now passes the class's own
  `private val auditService` (declared line 182, before the use site, so initialization order is
  fine) into `new WorkspaceTeardownService(...)`. The tests do NOT construct the service
  locally: `routesFor()` builds the real `ApiRoutes(...).routes` and the only new argument is
  `dbContext = dbContext`, which is what makes `workspaceTeardownServiceOpt` a `Some` and mounts
  `POST /api/workspace/teardown`. Every teardown assertion goes through a real HTTP
  `Post("/api/workspace/teardown", …)`. The `auditService` under test is therefore the one the
  production wiring supplies.

- **AC6 (null-default path intact).** `auditService: AuditService = null` default retained;
  existing 2-arg constructions (e.g. `WorkspaceTeardownServiceSpec`) still compile and pass —
  proven by the full-suite run below, which includes that 600-line spec.

- **AC5 (decision documented).** `design.md` Decision 1 states record-only-committed and
  "gate strictly on committed, not counts" explicitly, including the zero-match rationale;
  Non-Goals record the no-per-resource-row choice, and the Test plan pre-specifies the barrier
  requirement (design.md lines 17/23/27-49/84-99).

- **No scope creep / no regression into HEL-840.** The diff touches zero lines of
  `DataSourceService.scala`, `SourceService.scala`, `AuthService.scala` (confirmed by the
  file-level diff stat, which lists only the three code files above).

- **Gates re-run by me, output read:**
  - `sbt -batch "testOnly com.helio.api.AuditMutationInstrumentationSpec"` → 26/26 passed,
    including all four new HEL-838 tests.
  - `sbt -batch test` (full backend) → **3463 tests, 220 suites, 0 failed**, 191s.
  - `npm run check:repo-integrity | lint | typecheck | format:check | check:schemas |
    check:spec-structure | check:openspec | check:scala-quality` → all exit 0.
    schema-drift: 67 schemas across 48 protocol files in sync; spec-structure: 331 specs,
    0 issues; scala-quality: clean (135 pre-existing soft warnings, none new-file-specific
    beyond long-standing test-length budgets).
  - Frontend `npm test` not run: the diff contains zero frontend files, so Jest is provably
    unaffected. `lint`/`typecheck`/`format:check` were still run and are clean.

- **Not a bug fix**, so the `systematic-debugging` probe-confirmed-root-cause requirement does
  not apply; this is additive instrumentation with new positive and negative coverage.

### Verdict: CONFIRM

### Non-blocking notes

- PAT attribution for this specific action (`source=pat`, non-empty `actorTokenId`) is not
  covered by a teardown-specific test; it is covered generically elsewhere in this spec for
  other services, and the values are read straight off `AuthenticatedUser` with no
  teardown-specific logic, so the risk is low. A PAT variant of the committed test would close
  it cheaply.
- The negative-test barrier is a strong practical ordering argument rather than a formal
  happens-before (`AuditService.record` wraps the append in `Future(...)`). If this pattern is
  reused widely, an explicit drain/quiesce hook on `AuditService` would make it airtight.
- Post-commit `cleanupFiles` failure still leaves the single committed row unchanged, which
  matches design.md's stated intent; no metadata flag records a partial file-cleanup failure.
  Acceptable as designed, but worth revisiting if disk-orphan forensics ever matter.
