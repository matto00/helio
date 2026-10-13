## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `db0caabbb7800b07952d4e29971f202d3b8ae9c5` (branch `bug/single-panel-row-lock-order/HEL-1498`).
Diff base: `000c1dfa5769d2e2418c2494922fdb35b8c1f2d5`, resolved live with `resolve-review-base.sh`. origin/main is one
commit ahead (`317284497`, HEL-1444). That commit touches only frontend, e2e and openspec files, so it doesn't overlap
this change. Three commits: `13f0485fe` (split), `a5f33e75b` (red-first specs and evidence), `db0caabbb` (fix).

### Phase 1: Spec Review — PASS
Issues: none

- AC1: one id-ordered panel lock is the first write of every writer in the table below.

  | Writer | Lock |
  |---|---|
  | W1 `replaceContents` | `PanelRowLocks.lockForDeletion`, then dashboard `FOR UPDATE` |
  | W2 `batchUpdate` | app-level `sortBy(_.id).forUpdate` before the item loop |
  | W3 output delete | now one transaction, `deleteWithPanelsInternal`; `deleteInternal` also locks |
  | W4 pipeline delete | after the owner read |
  | W5 `deleteInternal` | tail subtrees plus the step, before the promotion UPDATE |
  | W6 root removal | first statement of `removeRootCascadeAction` |
  | W7 data-source delete | after the owner read |
  | W8 teardown | one call over tagged dashboards, pipelines and sources |
  | `DashboardRepository.delete` | through the same helper |

  I grepped every `.delete` / `DELETE FROM` in `infrastructure/persistence`. No other path deletes outputs, steps,
  roots, pipelines or data sources. Connector delete refuses when dependents exist, so it never cascades into
  `data_sources`.
- AC2 and AC3: the W1–W8 race specs are red at `a5f33e75b` and green at HEAD (see Phase 2). W4 and W8 run on a
  grantee-owned or untagged dashboard.
- AC4: the cumulative overlay covers updates, deletes with their cascades, panel-create placement, the
  `expectedLayoutVersion` conflict and the impact count. `before` and the fingerprint stay at pre-apply state. The
  documented residuals (step-create re-parenting, data-source-delete cascade) are listed as non-goals in
  proposal.md.
- AC5: split, verified in Phase 2.
- AC6: `DashboardDeleteRacesPanelDeleteSpec` asserts `(None, None)`, and `LockRaceSupport.sqlStateAllowing` rethrows
  any non-PSQL failure. Both ghost-layout guard cases carry `GUARD:`, and the legend has been added.
- AC7 / C1: `replaceContents` takes a required `layout`, locks the panels, locks the dashboard `FOR UPDATE`, writes
  only the computed layout and returns the re-read row. The HEL-1526 spec runs as a NOBYPASSRLS role. The
  owner-required red is reproduced (see Phase 2).
- AC8 / C3 / C4: the only migration change is `A V129__lock_panels_for_deletion.sql`. `git ls-tree origin/main`
  gives max V128, so V129 = max + 1. V1–V128 are untouched.
- C2: I ran no `sbt run` and no backend against the dev DB. Everything ran on embedded Postgres.
- C5: the race specs differ between `a5f33e75b` and HEAD by exactly the one-line `Some(layout)` -> `layout` call edit.
  The gate is test-harness only.
- Tasks 1.1–7.1 are all checked off and match the diff. The spec deltas (four capabilities) match the implemented
  behaviour.

### Phase 2: Code Review — PASS
Issues: none blocking

**Gates (my own fresh runs, `nice -n 19 sbt -J-Xmx3g`, local default caps).** The full suite takes about 12 minutes,
which is over the 10-minute limit for one tool call, so I ran it as three `testOnly` chunks covering every test
package. That includes the root-package `ScalaTestSummaryGuardSpec` and `DevEnvSpec`.

| Chunk | Exit | Succeeded | Failed | Canceled |
|---|---|---|---|---|
| `com.helio.api.*` | 0 | 2216 | 0 | 0 |
| `com.helio.services.*` | 0 | 1971 | 0 | 4 |
| `domain`, `infrastructure`, `spark`, `testkit`, `testsupport` and the root package | 0 | 3443 | 0 | 0 |

The total is 7630 succeeded, 0 failed, 4 canceled. That matches the executor's `testFull` count exactly; the 4
canceled are the `HELIO_MEASURE`-gated cases.

Other gates:
- `npm run check:scala-quality`: clean (soft warnings only).
- Prettier `--check` on the change dir and the README: clean.

**Red confirmed independently (claim 1, C3, owner requirement).** I made a throwaway detached worktree at `a5f33e75b`,
copied in the FINAL `PatchSetPreviewCumulativeSpec` from HEAD, and ran the race specs plus the cumulative spec there.
Exit was 1: 17 failed, 5 passed.
- HEL-1526 race is red: `breakpoint lg: Set() was not equal to Set(<created panel>)`.
- HEL-1526 version case is red: `Some(0) was not equal to Some(1)`.
- W1–W8 each fail with `(None, Some("40P01"))`.
- All 7 cumulative PROOF cases are red, including the two the executor added after its first red run (`Cascades to 2`
  vs `3`, and `200` vs `404`).
- The 3 cumulative GUARD cases and the 2 HEL-1485 cases are green.

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1498/evidence/evaluator-red-rerun-a5f33e75b.txt`. I
removed the throwaway worktree afterwards (`git worktree list` shows no straggler).

**Claim 2: the EXECUTE grants.** Verified. They don't mask a real-environment failure.
- Prod: `infra/deploy-backend.sh:110` sets `DB_USER=helio`. `Database.initApp` runs Flyway with that same user, and
  the `privileged` stanza in `application.conf:93-106` inherits `${helio.db.user}` and then runs
  `SET ROLE helio_privileged`. So the app pool is the migrating role, which gets V129's `CURRENT_USER` grant. The
  privileged pool is the function's owner.
- CI: `ci.yml:546-547` uses the same single `DB_USER=helio`.
- Dev: one URL user for both pools.
- The race specs run on `LayoutStripDbSupport`, the production shape: Flyway and the app share one NOSUPERUSER /
  NOBYPASSRLS role, and there is NO fixture grant. W4, W7 and W8 call the function from the RLS app pool, so V129's
  own grant is exercised exactly as in prod.
- The six fixtures that got a grant are ones where a superuser migrates and a separate `helio_app_test` role runs the
  app. They already hand-grant table privileges, and eight other specs already use the same
  `GRANT EXECUTE ON ALL FUNCTIONS` pattern (for example `RlsPrivilegedDmlSpec` and `PublicPathRlsSmokeSpec`).
- On the RLS testing gap: a superuser connection would bypass the EXECUTE check, but the production-shape specs above
  don't use one, so the gap doesn't hide anything here.
- Residual worth knowing: if prod ever splits the migrating role from the runtime role, the function will need an
  explicit grant. The V129 header comment says so.

**Claim 3: `PatchSetPreviewOutputContextSpec` loosening.** A legitimate consequence of AC4. The matrix deletes
`s.sourceId` (edit 7), and a later pipeline create roots on it (edit 11). Apply fails that, so cumulative preview must
reject it. The case's purpose, the full-schema "nothing written" checksum, is unchanged and still asserted, and the
per-edit loop above it still previews every edit singly. The `Right(_)` arm is now unreachable, which makes the
assertion weaker than necessary (see Non-blocking). It isn't a moved goalpost, because cumulativeness itself is
proved by `PatchSetPreviewCumulativeSpec`.

**Claim 4: W6.** Verified. `PipelineRootWrites.removeRoot` (`PipelineRootWrites.scala:211-215`) composes
`removeRootCascadeAction` first, and the lock is that action's first statement (`PipelineStepRepository.scala:1190`).
Every read before it runs outside the transaction (`listRootDataSourceIdsInternal`, `rootIdsOf`,
`listByPipelineInternal`, `listByPipelineInternal` for outputs).

**Claim 5: dead code removed.** Verified. `PanelRepository.deleteByOutputIdInternal`,
`PipelineStepRepository.delete`, `PipelineRootRepository.remove` and `OutputRepository.deleteByNodeInternal` are gone,
and the code compiles, so none had callers. The one test case for the removed `stepRepo.delete` was dropped along with
it.

**Claim 6: migration.** Verified as V129 = origin/main max (V128) + 1. Only an `A` entry under `db/migration`.

**Claim 7: the split is behaviour-preserving.** Verified. In `13f0485fe` alone, a sorted, whitespace-normalised
line-set diff of the old `PatchSetPreviewProjection.scala` against the six new files shows only three kinds of change:
- `private` became `private[patchsets]`;
- calls became object-qualified (`PatchSetPreviewXProjection.f`, `PatchSetPreviewProjection.PendingId`);
- imports were split, and the unused `ExpressionEvaluator` import was dropped.

There is no logic change.

**Other checks:**
- Data-source delete now adds an explicit `ownerId` filter. That is equivalent to the only `data_sources` policy, V35
  owner-only, so it isn't a behaviour change.
- No inline FQNs, no TODO/FIXME, no new `asInstanceOf`. The one `null` is an unused `accessChecker` in a test, which
  follows existing convention.
- Size budget: every new or split file is under 250 lines. The largest is `LockRaceSupport` at 168.

### Phase 3: UI Review — N/A
Backend only. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed. The change-dir
spec deltas are not under `openspec/specs/`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewOutputContextSpec.scala:304-308`: the outcome
  is deterministic after the fix, so assert exactly `Left(ServiceError.NotFound(msg))` with
  `msg should startWith("data source not found")` and drop the `Right(_) => succeed` arm. Right now a regression that
  stopped threading the overlay would still pass this case.
- Pre-existing over-budget files grew slightly: `OutputRepository.scala` 372→382, `PipelineRepository.scala` 721→728,
  `DataSourceRepository.scala` 1210→1219. These are soft-budget warnings only, and the checker is clean. The "every
  file under ~250 lines" claim holds for new and split files only.
- `PatchSetPreviewDashboardProjection.scala:32`: a single-edit preview with a stale `expectedLayoutVersion` now
  returns 409 where it used to return 200. That is parity with apply (HEL-1457) and inside the delta spec's wording,
  but no test pins the single-edit case. Consider one GUARD/PROOF case.
- `red-evidence.md` cites W4–W8 failures at `PipelineCascadeLockOrderRaceSpec.scala:71..100`. The committed file at
  `a5f33e75b` fails at `:72..101`, so the recorded run was against a one-line-different draft. This doesn't matter in
  substance, because my rerun at the committed `a5f33e75b` reproduces every red.
