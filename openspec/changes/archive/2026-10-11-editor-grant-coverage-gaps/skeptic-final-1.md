## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed: `task/editor-grant-coverage-gaps/HEL-1488` at HEAD `e4a8ca28a8b13441cfaf8e7ae0028b7a64721ec2`. The base was resolved live with `resolve-review-base.sh`: `bcb0e891923094c1a1e85ecc053f30a73ee6d70f`.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/editor-grant-coverage-gaps/HEL-1488`.
- **Diff scope:** `git diff bcb0e8919...HEAD` touches:
  - 3 main files (comments only, see AC5 below);
  - 2 new specs (`EditorGrantCoverageSpec`, `ResourcePermissionRoleFallbackSpec`);
  - 3 extended specs (`PipelineRunServiceSpec` +4, `AccessCheckerImplSpec` +2, `AclDirectiveSpec` +2);
  - the openspec change dir.
- **AC5, comment-only:** this filter printed nothing (grep exit 1):
  `git diff -U0 bcb0e8919...HEAD -- backend/src/main | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*|/\*\*)'`
  I also read the full main diff: two `//` lines in ResourcePermissionRepository and scaladoc text in PipelineCreateTransaction and PipelineRootWrites.
- **AC4, citations:** `grep -rn resolveRootDataSources backend/src` returns no hits.
  - `PipelineCreateTransaction.scala:32-33` now names `PipelineRootWrites.resolveOneRootSourceId` (400 shape/blank id) and `PipelineCreateWrites.lookupOwnedRoots` (404 unowned). Both exist (`PipelineRootWrites.scala:36`, `PipelineCreateWrites.scala:195`). `lookupOwnedRoots` runs before `createTransactional` (`PipelineCreateWrites.scala:168-170`). Accurate.
  - `PipelineRootWrites.scala:30` now says "`PipelineCreateWrites.create`'s root pass". `createRootSources` (root pass (b), reached from `create`) calls `resolveOneRootSourceId` at `:188`. Accurate.
- **Independent mutation battery.** Driver: `/home/matt/Development/helio/.concertino/runs/HEL-1488/evidence/skeptic-run.sh`, using the run's `mutl.py`: a line-scoped one-occurrence replace, a targeted `nice -n 19 sbt -batch -J-Xmx3g testOnly`, then an unconditional revert. Logs are `SKEP-*.log` in the same dir; the summary is `SKEP-summary.log`.
  - **Unmutated** (all 5 touched suites): exit 0, `Suites: completed 5`, `Tests: succeeded 128, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. 128 = 91+12+7+17+1, which matches `test-count-evidence.md`.
  - Every mutation went red with an attributable new-test failure, and each log shows a `[hel1468-guard] failed=N` line:
    - S7-V `PipelineRunService:197 case Some("editor") -> case Some(_)` (HEL-1482 F-P1-V): 2 killers, viewer real and viewer dry. Excerpt: `Right(RunResultResponse(...)) was not equal to Left(Forbidden("Forbidden"))`. The weakened gate surfaces as a Right, and the exact-equality assertion catches it.
    - S1-V `PanelService:221 $VA -> $VA if false`: viewer test red (`Right(Vector(DividerPanel(... "Edited by viewer" ...)))`).
    - S1-E `PanelService:221 $VA | Right(Editor)` (F-D5-E): editor test red.
    - S2-V and S2-E `DashboardContentsService:148` (F-D8-V/E): viewer and editor tests red respectively.
    - S2-O `DashboardContentsService:144` owner short-circuit `Right(()) -> Left(Forbidden())`: owner test red (`expected the owner's contents replace to be accepted`).
    - S3-V `DashboardService:254 $VA if false` (F-D10-V): viewer red (`Right(DashboardSnapshotPayload(...))`).
    - S3-E `DashboardService:254`: editor red.
    - S8-V `OutputService:140 $VA if false` (F-P7-V): viewer red (`Right((Output(...)))`).
    - S8-E `OutputService:140`: editor red.
    - S4 `AccessCheckerImpl:83 Right(Viewer) -> Right(Editor)` (F-D13): red.
    - S5 `AclDirective:141 provide(Viewer) -> provide(Editor)` (F-D18): red, `"[Edito]r" was not equal to "[Viewe]r"`.
    - S6 `ResourcePermissionRepository:38` (was :36 before the 2 comment lines) `getOrElse(Role.Viewer) -> getOrElse(Role.Editor)` (F-D19): red, `Some((..., Editor)) was not equal to Some((..., Viewer))`.
  - **Tree reverted:** `git status --short` is identical before and after (only the two untracked evaluation reports), `git diff --stat` is empty, and HEAD is unchanged. No sbt process from this gate remains.
- **Owner coverage, executor logs checked:**
  - `S1-O.log`, `S3-O.log`, `S8-O.log`: `failed=1`.
  - `S7-O.log`: `failed=51`. The site-7 owner path is pinned by the pre-existing owner-run tests in `PipelineRunServiceSpec`.
  - Sites 2 and 3: the `ownerId == user.id -> false` mutants are correctly recorded as equivalent (the owner falls through to `requireAccess` -> Owner -> `Right(_)`). I independently re-killed the site-2 owner test via the short-circuit arm (S2-O above).
- **AC2/AC3, assertion exactness (read in full):**
  - Viewer outcomes are exact `Left(ServiceError.Forbidden())` (sites 1/2/3/8) or exact `Left(ServiceError.Forbidden("Forbidden"))` (site 7). Each is paired with an unchanged-state re-read.
  - Editor and owner accepts use `getOrElse(fail(...))` and then an observed effect:
    - re-read panel title;
    - old panel gone, new titles;
    - export payload name and panel count;
    - Output re-listed by id;
    - site 7: `RunResultResponse` with `rowCount 2`, `sourceRowCount 2`, `blocked false`.
  - Site 5: exact 200 + body `"Viewer"`, and exact 404 + `ErrorResponse("Dashboard not found")`.
  - Site 4: exact `Right(ResourceAccess.Viewer)` / `Left(NotFound(msg))`.
- **Site 6 soundness and isolation:**
  - `ResourcePermissionRoleFallbackSpec` starts its own `VerifiedEmbeddedPostgres.start(...)` cluster in `beforeAll` and closes it in `afterAll`.
  - It first shows that V16's CHECK rejects `'owner'`, which is why the arm is unreachable in production.
  - It finds the unnamed CHECK through `pg_constraint` and asserts exactly one match before dropping it. No other spec shares the cluster.
- **Harness and style:**
  - Both new spec files use `VerifiedEmbeddedPostgres.start`.
  - No inline FQNs in the added test code (`ShareTokenValidator` is imported; `ResourceType` is import-renamed).
  - `[hel1468-guard]` appears in every sbt log I produced.
- **AC6:** no new test failed on unmutated code, so there was no authorization defect to escalate.

### Verdict: CONFIRM

### Non-blocking notes

- In the site-7 viewer real-run test, the secondary checks `countAssertionRows() shouldBe before` and "no run row" are vacuous for a non-owner, because non-owner runs never persist those rows. The exact `Left(Forbidden("Forbidden"))` is the load-bearing assertion and it kills the mutation. The block comment at `PipelineRunServiceSpec.scala:547-550` says as much.
- The new site-7 editor accept tests partly duplicate the pre-existing editor tests (~:521/:535). This is harmless.
- The evaluator's carried-over follow-up suggestion stands for the orchestrator: a non-owner editor's real run persists no `pipeline_runs` row and bypasses the HEL-505 concurrency cap. It is out of scope here and pre-existing behaviour.
- No UI changes, so the design review (step 4) does not apply.
