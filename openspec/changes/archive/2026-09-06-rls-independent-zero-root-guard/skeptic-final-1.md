## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is from a command I ran or a file I read in this
worktree; the executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**0. The diff is exactly what it should be.** `git diff --stat main..HEAD` is misleading here
(main has advanced past merge-base `abcf0da9`, so `ff0552c4`/`010f67f0` show up inverted as
`e2e/tsconfig.json` and `PipelineRiverView.test.tsx` "changes"). `git diff --stat main...HEAD`
is the truth: 16 files, backend + change-dir only, **zero frontend/e2e files**. No UI gate
applies to this change.

**1. Only V100 is added; V99 and every other applied migration are byte-unchanged.**
`git diff --name-status main...HEAD -- backend/src/main/resources/db/migration/` returns exactly
one line: `A .../V100__zero_root_guard_rls_independent.sql`. No `M`, no `D`. Confirmed.

**2. The fix works, and V100 is load-bearing — proven by my own mutation, not the report's.**
I ran the new spec myself:

```
[info] V100ZeroRootGuardNonSuperuserSpec:
[info] Tests: succeeded 12, failed 0 ... All tests passed.
```

Then I **deleted `V100__zero_root_guard_rls_independent.sql` from disk** and re-ran:

```
[info] - should 3.2 positive gate ... *** FAILED ***
[info] - should 3.6 guard-liveness: the trigger function is owned by helio_privileged *** FAILED ***
[info] Tests: succeeded 10, failed 2
```

3.2 (the AC1 gate) and 3.6 both go red without V100. The file was restored and the tree is clean.
V100's header claim — re-own to `helio_privileged` makes the `SECURITY DEFINER` body read with
BYPASSRLS — is what the passing 3.2 measures directly (P0001 raised, `pipelines=1, roots=1,
data_sources=1` after rollback, on a `SET ROLE helio_privileged` connection with the GUC never set).

**3. The D9 pre-check is load-bearing, and 3.7c is not vacuous — proven by my own mutation.**
3.7c would pass without D9 on `result.isLeft` alone (the race-path recover also produces a
conflict); the only assertion that distinguishes it is file survival. I removed the
`soleRootDependentPipelineCountPrivileged` branch from `DataSourceService.delete` and re-ran:

```
[info] - should 3.7c divergence gate ... *** FAILED ***
[info]   false was not equal to true (V100ZeroRootGuardNonSuperuserSpec.scala:503)
```

That is the `fileSystem.exists(filePath) shouldBe true` line — without D9 the backing file is
destroyed before the trigger refuses. The pre-check genuinely runs before `deleteFileF`, and the
file genuinely survives a refused delete. Source restored; `git status` clean.

**4. The two pools are genuinely distinct — established in both directions by passing assertions,
not by inspection alone.** In 3.7c/3.7d/3.7f the fixture-liveness assertion
(`soleRootDependentPipelines(...) shouldBe empty`, on `appDb`) runs *before* the divergence
assertion and passes — so the app pool really is RLS-enforcing (a shared BYPASSRLS pool would
return the stranger's pipeline and fail liveness). Simultaneously the D9 count query on
`privilegedDb` returns >0 for that same invisible pipeline — so the privileged pool really is
BYPASSRLS. Both facts are required for the suite to be green as observed. `connectionInitSql =
"SET ROLE helio_privileged"` in the spec matches `application.conf:106` verbatim.

**5. probe.md's mutation states A and B are real and reproduce in-suite; the function is restored.**
Both 3.7 (state A → silent orphan, `msg=None`, `pipelines=1/roots=0`) and 3.7a (state B → loud
`42501`, "row-level security policy") passed in my run. Both mutate via the EmbeddedPostgres
superuser connection only (never the migration file on disk) and both call `restoreV100State()`
in a `finally`. The trailing "post-mutation sanity" test re-asserts P0001 *and*
`pg_proc.proowner = helio_privileged` — so later tests (the whole D9 block) are demonstrably
running against the unmutated function.

**6. D9 leaks nothing.** `soleRootDependentPipelineCountPrivileged` projects `count(*)` and
nothing else; the branch builds `soleRootConflict(source, Vector.empty)`, whose
`resourceKind/resourceId/resourceName` are the *source's* identity. 3.7d asserts the pipeline id
and name appear in neither `reason`, `resourceId`, `resourceName`, nor `err.message`. No log line
is emitted on that branch. The predicate is pinned to `soleRootDependentPipelines`'s own
(`HAVING count(*) = 1 AND bool_and(...)`), so it cannot 409 a multi-root delete — 3.7f proves that
directly (invisible multi-root pipeline → delete succeeds, file removed).

**7. No false positives.** 3.4 (one of two roots), 3.5 (whole pipeline), 3.7f (multi-root under an
invisible pipeline), 3.7e (visible blocking pipeline still gets HEL-987's named 409, unchanged).
The one intentional behaviour change — a cross-tenant sole-root delete that previously *succeeded
while silently creating an R1-violating orphan* now returns 409 — is the fix, is documented in
design.md D9, and is not a defect.

**8. I checked the spec delta's one remaining untested assertion myself.** The spec claims the
plain app-pool / GUC-never-set shape is "unreachable, not unprotected". I added a temporary probe
test to the spec and ran it:

```
SKEPTIC app-pool/GUC-unset => state=Some(42704) msg=Some(ERROR: unrecognized configuration parameter "app.current_user_id")
SKEPTIC post-state pipelines=1 roots=1 ds=1
```

The claim is true: the outer DELETE errors before the trigger, nothing is deleted, no orphan. The
temporary test was reverted (`git checkout`; tree clean).

**9. Documentation holds to this ticket's own standard.** V100's header, the spec delta, and
design.md make no claim I could falsify. Notably design.md explicitly retracts an earlier draft
bullet as false and scopes the cross-tenant-id statement to "does not reach an API client — a
property of the caller, not of the trigger", which is exactly right. The `GRANT CREATE / ALTER
FUNCTION ... OWNER TO / REVOKE CREATE` bracket is byte-for-byte V40's (`V40__*.sql:37-42`) as
claimed. AC5's V99-header half is settled by the `v100-header-only` ruling; the archived HEL-913
`tasks.md` caveat is updated and accurate.

**10. Full gates, re-run by me.**
- `sbt test`: `Suites: completed 256, aborted 0 / Tests: succeeded 3892, failed 0` — matches the
  evaluator's asserted totals exactly. `FlywayNonSuperuserMigrationSpec` (the prod-dump,
  non-superuser replay) is inside that run and green.
- `check:repo-integrity`, `check:schemas` (74 schemas / 48 protocol files in sync),
  `check:spec-structure` (351 specs, 0 issues), `check:openspec` (clean),
  `check:scala-quality` (clean, soft warnings only), `check:no-credential-leak` (0 violations) —
  all pass.

### Verdict: CONFIRM

The guard is now RLS-independent, the fix is mutation-proven in both directions by evidence I
generated independently of the executor's, no already-applied migration was touched, and no
assertion in the shipped artifacts survived my attempts to falsify it.

### Non-blocking notes

- `DataSourceService.deleteAfterPrecheck`'s race-path `log.warn(s"...", ex)` logs the
  `PSQLException`, whose message text names the orphaning pipeline id. Post-V100 that id can be
  cross-tenant. Nothing asserts otherwise (design.md scopes its non-disclosure claim to the API
  client, and the repository doc scopes its claim to the invisible-pipeline *branch*, both
  accurate), and the D9 pre-check narrows this to a genuine TOCTOU window — so this is a residual,
  honestly-documented operator-log exposure, not a defect in this change. Worth a line in a future
  ticket if operator logs are ever treated as tenant-scoped.
- `evaluation-1.md` and `evaluation-2.md` are untracked in the worktree; they should be committed
  with the rest of the change record before archive.
