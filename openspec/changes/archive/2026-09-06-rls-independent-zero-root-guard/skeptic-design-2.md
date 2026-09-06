## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-zero-root-db-guard/spec.md`,
  `skeptic-design-1.md` in full from the worktree.
- **Round-1 CR1 (contradictory mutation states) — ADDRESSED in tasks, NOT in design.**
  `tasks.md:73-84` now defines two genuinely distinct, mutually exclusive states:
  A = revert `OWNER TO` **and** remove `SET row_security = off` (expected red: silent non-raise,
  post-state `roots=0`); B = revert `OWNER TO` and **keep** `SET row_security = off` (expected red:
  loud `42501`, `query would be affected by row-level security policy`). Each is individually
  achievable and each has an unambiguous right-reason red; 3.7a explicitly instructs that B's `42501`
  is NOT to be discarded as A's wrong-reason `permission denied`. That resolves the round-1
  contradiction. **But** `design.md`'s D5 list stops at step 4 — there is no step 5 — while `D2:71`,
  `D8:202` and task `3.7a` all cite "D5 step 5". See CR1.
- **Round-1 CR2 (BYPASSRLS trigger vs RLS-scoped pre-check) — substantively addressed, with two gaps.**
  Verified the premise against real code, not the narrative:
  - `DataSourceService.delete` (`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:579-605`)
    does run `soleRootDependentPipelines` (RLS-scoped, `ctx.withUserContext`) and then `deleteFileF`
    before `dataSourceRepo.delete`; the `recover` branch maps `P0001` to
    `soleRootConflict(source, Vector.empty)` — after the file is gone. The hazard D9 describes is real.
  - A privileged pool genuinely exists and is genuinely `BYPASSRLS` in production:
    `DbContext.withSystemContext` → `privilegedDb` (`DbContext.scala:53-64`), wired in
    `Main.scala:83-88` via `Database.initPrivileged`. So a count-only privileged pre-check is
    implementable and is NOT vacuous in prod (it will see the invisible pipeline). Precedent for the
    count-only shape already exists: `DataSourceRepository.countRestSourcesReferencing`.
  - **Sufficiency:** run after the RLS-scoped check and strictly before `deleteFileF`, a non-zero
    count → generic 409 preserves the file and discloses nothing, since only an integer crosses the
    seam. I could not find a path where the file is destroyed before refusal on the non-race path.
    On the pre-existing TOCTOU race path the file is still destroyed before the `P0001` recover —
    unchanged by this design, noted below as non-blocking.
  - **False positives:** a privileged *sole-root* count blocks exactly the deletes the post-fix
    trigger would raise on, so it introduces no new false positive *provided the predicate is the
    same sole-root predicate*. `tasks.md:31-33` does not pin that, and there is no service-level
    multi-root negative test. See CR3.
- **Round-1 CR3 (mutating V100 against the shared dev DB) — ADDRESSED.** D8 (`design.md:200-210`)
  confines all probe/mutation work to EmbeddedPostgres, pins the sequencing (probe + both mutation
  states → freeze V100 body → dev-DB boot check), and names the recovery. `tasks.md:38` marks 1.7 as
  the LAST backend task "after V100's body is frozen"; `3.7b` restates the constraint. Consistent, no
  contradiction found.
- **Independent check of the D9 test tasks against the actual harness (the finding that drives CR2).**
  `DataSourceRoutesSpec` (`backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala:87-99`)
  boots EmbeddedPostgres, migrates and connects as the **`postgres` superuser**, and constructs
  `new DbContext(db, db)` — the app pool and the "privileged" pool are the *same* connection. In that
  harness RLS is bypassed on both pools, so an "invisible" pipeline is fully visible to
  `soleRootDependentPipelines`, and `withUserContext` / `withSystemContext` are indistinguishable.

### Verdict: REFUTE

The D9 direction is right and the round-1 items are materially improved. Three specific defects remain,
one of which (CR2) would produce exactly this ticket's failure class — a gate that cannot observe the
thing it certifies.

### Change Requests

1. **`design.md` D5 has no step 5, but three places cite one.** D5 (`design.md:108-122`) lists steps
   1–4 only; `D2:71` ("D5 step 5"), `D8:202` ("D5 steps 1-5") and `tasks.md:79` ("design D5 step 5")
   all dereference a step that does not exist. Add D5 step 5 to the design, defining MUTATION STATE B
   (revert `OWNER TO`, keep `SET row_security = off`; expected red = loud `42501` /
   "query would be affected by row-level security policy"; a silent red here means the tripwire is
   dead) and make step 4 name MUTATION STATE A explicitly, so the design and `tasks.md:73-84` say the
   same thing. As written, the artifact the executor is told is authoritative contains a dangling
   reference to the deliverable the owner called co-equal with the fix.

2. **Tasks 3.7c / 3.7d / 3.7e are not implementable as written in the harness they would naturally
   land in, and would pass vacuously.** 3.7c requires "a `pipeline_roots` row pointing at the caller's
   OWN source where the `pipelines` row is INVISIBLE to the caller". The existing service/route
   harness (`DataSourceRoutesSpec.scala:87-99`) migrates and connects as `postgres` (superuser,
   BYPASSRLS) and passes `new DbContext(db, db)`, so (a) nothing is ever invisible to the RLS-scoped
   pre-check, and (b) the user pool and privileged pool are the same connection. In that harness the
   fixture takes the *visible* branch: 3.7c's "refused with a 409" passes for the wrong reason,
   3.7d's non-disclosure assertion would fail against HEL-987's correctly-named 409, and 3.7e cannot
   distinguish the two branches at all. Required: the plan must name where these three gates run and
   how the invisibility is really produced — either a non-superuser harness of the D4 shape
   (`helio_migration_test` app connection + a real `helio_privileged` privileged connection, two
   distinct `JdbcBackend.Database`s in the `DbContext`), or an explicitly-stated repository-seam
   fake where the RLS-scoped call returns empty and the privileged count returns non-zero — and must
   add a **liveness assertion for the fixture itself**: assert that `soleRootDependentPipelines`
   returns empty for that fixture, so the divergence gate cannot silently degrade into a re-test of
   the visible path.

3. **The privileged check's predicate is unpinned, and its false-positive risk is ungated at the
   service layer.** `tasks.md:31-33` says only "a privileged, COUNT-ONLY sole-root check"; D9
   (`design.md:159-167`) calls it a "companion check" without stating the predicate. If an executor
   reaches for the broader any-referencing shape (the `WorkspaceTeardownRepository`
   source-dependent-pipeline predicate that `DataSourceRepository:219-222` explicitly warns was the
   *rejected* scope), every multi-root delete starts returning a generic 409 that the trigger would
   never have raised — a new, user-visible false positive. Required: (a) state in D9 and in task 1.6a
   that the privileged query is the *identical* sole-root predicate as
   `soleRootDependentPipelines` (`HAVING count(*) = 1 AND bool_and(...)`), differing only in pool and
   in projecting `count(*)` instead of `(id, name)`; and (b) add a service-level negative gate — a
   source that is one of several roots (including of an invisible pipeline) still deletes
   successfully and its file is removed. Existing task 3.4 does not cover this: it is a SQL-level
   assertion inside `V100ZeroRootGuardNonSuperuserSpec` and never exercises the new Scala pre-check.

### Non-blocking notes

- D9's guarantee is "no *new* file destruction", not "no file destruction". The pre-existing TOCTOU
  race path (`DataSourceService.scala:600-604`) still deletes the file before mapping `P0001`.
  Worth one sentence in D9 so nobody later reads D9 as having closed the race window too.
- The privileged count adds one query to every data-source delete. Negligible, but if the RLS-scoped
  check already returned a non-empty result the privileged check is dead work — short-circuit it
  (the current task ordering already implies this; making it explicit costs nothing).
- Task 3.7d's "nothing logged on that path carries one either" is only meaningful if the new branch
  logs at all. If the chosen implementation emits no log line there, say so rather than asserting
  absence against silence.
