## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold review, scoped as instructed to the two round-2 fixes (`2365e94d`), the spec-delta reassignment
(`83729742`), and a full regression re-run. Every conclusion below is from files, the diff, gates I
ran myself, and five live SQL probes against the migrated database.

### What I verified (with evidence)

**Process hygiene.** A stale backend (PID 930509 on `:9252`) and a stale Vite (930852 on `:6345`)
from a prior session were killed and both ports confirmed free BEFORE `start-servers.sh`, so nothing
below was measured against stale code. `start-servers.sh` then applied V99 to the dev DB
(`flyway_schema_history` top version = `99`, was `98` before the restart).

**Gates — all re-run by me in this worktree.**

| gate | result |
|---|---|
| `sbt -batch test` | **PASS** — `Tests: succeeded 3737, failed 0`, 246 suites, exit 0 (was 3732 in round 2; +5 new, matching the commit's claim) |
| `npm run lint` / `typecheck` | PASS |
| `npm test` | PASS — 252 suites / 2590 tests |
| `check:schemas` / `check:openspec` / `check:spec-structure` / `check:repo-integrity` / `check:scala-quality` | PASS |
| `check:node-root-encoding` / `check:e2e-types` / `check:helio-mcp-types` | PASS |
| `assert-phase.sh servers` | `PASS servers` |
| Playwright (`DEV_PORT=6345 BACKEND_PORT=9252`) | **37 passed, 1 failed** — sole red is `hel910-pipeline-to-dashboard-flow.spec.ts:144` (`/pipelines/undefined`), the documented HEL-969 expected red. Byte-identical to round 2: no regression. |
| `openspec validate --strict multi-root-pipelines` | exit 0 (3 pre-existing tasks.md numbering warnings only); 11 deltas remain |

**No UI to judge.** `git diff a45e9881..HEAD -- frontend` is empty; `frontend/**` is an explicit
non-goal. Section 4 of my brief does not apply.

**FIX 1 — V99 closes the round-2 repro. Verified independently, in a PROD-SHAPED RLS configuration,
not merely by reading the executor's test.** V99 is applied (`hel913_prevent_zero_root_pipelines_trigger`,
`tgenabled = 'A'` i.e. `ENABLE ALWAYS`), the function is `prosecdef = t` with
`proconfig = {search_path=pg_catalog, public}` — `search_path` IS pinned, which is better hygiene than
the V36/V39 precedent it cites (those pin nothing). The function takes no arguments, contains no
dynamic SQL, reads only, and is a trigger function (uncallable usefully outside trigger context), so
the classic `SECURITY DEFINER` escalation shapes do not apply.

- **Positive direction (the guard fires).** In a rolled-back transaction I re-owned ONLY the trigger
  function to a purpose-built `NOSUPERUSER NOBYPASSRLS` role — the shape of prod's Flyway `DB_USER`
  — seeded a user + data source + pipeline + sole root, set `app.current_user_id` to the owner, and
  ran round 2's own repro `DELETE FROM data_sources WHERE id = <sole root's source>`:
  `ERROR: HEL-913: this delete would leave pipeline(s) [probe-pipe] with zero roots (R1 violation)`.
  Round 2's repro now comes back the other way, under real RLS enforcement, not only as superuser.
- **The subtle half — whole-pipeline delete must NOT raise — is real, not asserted.**
  `V99PreventZeroRootPipelinesMigrationSpec` test 3 executes `DELETE FROM pipelines WHERE id = …`
  against a fully-migrated embedded Postgres and asserts `noException` plus `pipelines = 0`,
  `pipeline_roots = 0`. The statement-level/transition-table reasoning holds because the row-level FK
  cascade completes before the end-of-statement trigger runs. That test would go red if the trigger
  were written `FOR EACH ROW`.
- **V98's own constraints applied to V99.** V99 performs no DML on any FORCE-RLS table — it only
  `CREATE OR REPLACE FUNCTION` + `CREATE TRIGGER` + `ALTER TABLE … ENABLE ALWAYS TRIGGER` — so the
  `NO FORCE` bracket V98 needed is genuinely not required here. `FlywayNonSuperuserMigrationSpec`
  migrates V1→newest as a genuine `NOSUPERUSER NOCREATEDB NOBYPASSRLS` role, so V99 *applying* is
  covered for free, and I confirmed it green in the full run.
- **Mutation proof** not re-run: my two live probes (raises with GUC set / does not raise with GUC
  unset, below) bound the trigger's behavior from both sides directly, which is strictly stronger
  evidence than re-observing the executor's no-op.

**FIX 2 — verified.** `PipelineService.removeRoot:813-822` now refuses at its own entry point with
`ServiceError.InternalError("Root removal is unavailable (no OutputRepository configured)")`, in the
same `if/else if` chain as the `pipelineRootRepo == null` guard, mirroring `createTransactional:312`
verbatim in shape and message form. The silent `Future.successful(0)` is gone from `removedOutputsF`
(:871-875), so there is no second path back to a false zero. The new test
(`PipelineRootRoutesSpec`, "500s and removes NOTHING when outputRepo is not wired") builds a
`PipelineService` with `outputRepo` deliberately omitted and asserts `StatusCodes.InternalServerError`
**and** that both root ids survive. If the silent-0 fallback returned, the call would 200 and remove
the root — the test fails on both assertions. It is not a re-worded pass.

**Spec-delta reassignment (`83729742`) — partially verified; one residual false claim, CR1 below.**
The two deltas are gone (`specs/` holds 11 directories, neither `pipeline-proposal-*` present); no
`specs/` file mentions proposals; `design.md` makes no `PipelineProposal … roots[]` claim; the §11
docs corrections (`docs/agent-native.md`, the remodel design doc) correct only `create_pipeline`, not
proposals. `proposal.md` gained the correct "Proposals are NOT in scope" bullet — but its earlier
"What Changes" bullet was left standing and says the opposite.

---

### Verdict: REFUTE

Both change requests are small and precisely scoped; neither reopens ground rounds 1-2 cleared. CR2
has a documentation-only minimum, so it need not require code.

### Change Requests

**1. `proposal.md:16` still claims proposals carry `roots[]`, directly contradicting `proposal.md:23-25`
of the same document.**

```
- **BREAKING** `POST /api/pipelines` and `create_pipeline` take `roots[]` … in place of the scalar
  `sourceDataSourceId`. `PipelineProposal.source` likewise becomes `roots[]`.     <-- line 16
```
Three bullets later: *"**Proposals are NOT in scope** and stay singular-source. `PipelineProposal`
carrying `roots[]` is **HEL-914**'s."* `83729742` removed the Capabilities line and added the
non-scope bullet but did not touch line 16. `PipelineProposal` is unchanged in this diff, so the
sentence is false of the shipped system and would be archived as a false statement — the exact
defect class this change exists to end.
**Required:** delete the sentence "`PipelineProposal.source` likewise becomes `roots[]`." from
`proposal.md:16`. One line.

**2. V99's guard is RLS-blind in the production role configuration, and V99's own header plus
`tasks.md:245-247` state the opposite as fact.**

Measured, in a rolled-back transaction, with only the trigger function re-owned to a
`NOSUPERUSER NOBYPASSRLS` role (prod's Flyway `DB_USER` shape) and `app.current_user_id` **unset**:

```
DELETE FROM data_sources WHERE id='probe-ds';
DELETE 1
CASE_A_NO_RAISE pipelines=1 roots=0     -- the round-2 orphan, recreated, guard silent
```

With the GUC set to the pipeline owner the same delete raises (quoted above). The difference is
RLS: `pipelines` and `pipeline_roots` both have `relforcerowsecurity = t`, and both `SELECT`
policies are `helio_can_access_pipeline(...)`, which returns FALSE on an unset/empty GUC. A
`SECURITY DEFINER` function owned by the migrating role is **subject** to FORCE RLS — this is
precisely what `V40__fix_rls_policy_function_recursion.sql` documents ("They were owned by the
migrating role (DB_USER), which OWNS the tables and is therefore subject to FORCE ROW LEVEL
SECURITY … Why it shipped green: dev and CI connect as a Postgres superuser"). V99's tests run as
`postgres` (superuser definer, BYPASSRLS), so all 4 would stay green even if the trigger were fully
blinded; `FlywayNonSuperuserMigrationSpec` performs no delete and never fires the trigger. So the
guard's enforcement has **zero** non-superuser coverage, and the two claims —
V99's header *"the check must see the REAL state of `pipelines`/`pipeline_roots` regardless of the
calling role's RLS visibility"* and `tasks.md:245-247` *"`FlywayNonSuperuserMigrationSpec`
re-confirmed green, proving the SECURITY DEFINER trigger also works correctly under real,
non-superuser RLS enforcement"* — are both false.

**Severity, stated plainly so the owner can rule.** The *user-facing* repro is genuinely closed:
`DataSourceRepository.delete:216-217` runs under `ctx.withUserContext`, so the GUC is set and the
guard fires (I proved this directly). I enumerated the `withSystemContext` data-source paths —
`countRestSourcesReferencing:226-234` (a count) and the startup config migration — and neither
deletes; `WorkspaceTeardownRepository:17` deletes sources but is explicitly `withUserContext`. So
today the vacuity is **latent**, not live. What is not latent is that the DB-level placement's sole
stated rationale — "closes for EVERY writer, including ones that don't exist yet (a future
migration, an admin script, a different service method)" — is exactly the population the guard does
NOT cover (an admin script or migration has no `app.current_user_id`), and that rationale would be
archived as fact.

**Required — either:**
(a) *the V40-shaped fix*: re-own `hel913_prevent_zero_root_pipelines()` to `helio_privileged`
(BYPASSRLS), copying V40's transient `GRANT CREATE ON SCHEMA public` / `REVOKE` bracket, plus one
test that fires the trigger with the GUC unset and a non-superuser definer and asserts it still
raises; **or**
(b) *documentation-only*: correct V99's header comment, `tasks.md:245-247`, and `design.md` R1 to
state the guard's real contract — "enforces for any writer running under a user context; a delete
without `app.current_user_id` (privileged pool, admin script, migration) is NOT covered, and no
shipped path currently takes it" — and drop the false `FlywayNonSuperuserMigrationSpec` proof claim.
Do not ship the current wording either way.

### Non-blocking notes / spinoff-ticket candidates

1. **SPINOFF CANDIDATE — `pipelines_select` visibility can also fail the guard open cross-user.** A
   pipeline editor may add a source they own as a root of someone else's pipeline
   (`addRoot` → `dataSourceRepo.findByIdOwned`); if their editor grant is later revoked and they then
   delete that source, the trigger evaluates `helio_can_access_pipeline` as them, sees nothing, and
   the orphan is created. Narrow and grant-order-dependent; option (a) of CR2 closes it incidentally.
2. Round-2 non-blocking notes 1-3 (dead `PipelineRunService.resolvePrimaryDataSourceInternal:224`;
   `resolveAllRootDataSourcesInternal:237-242` silently dropping an unresolvable root against an R9
   "never partial" comment; the stale `PipelineRepository.summaryQuery` docstring) and round-1 notes
   2-4 are still unaddressed and still stand. All spinoff-ticket candidates, not change requests.
