## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `task/editor-grant-coverage-gaps/HEL-1488` at HEAD bcb0e891923094c1a1e85ecc053f30a73ee6d70f (= base; planning artifacts untracked).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/editor-grant-coverage-gaps/HEL-1488`.
- Read ticket.md, proposal.md, design.md, tasks.md, `.openspec.yaml` (`skip_specs: true`; tests + comments only, so no spec delta is needed).
- HEL-1482's exact surviving mutations: `/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/confirm.sh` and the archived `mutation-evidence.md` table (rows for the 8 sites). Design D1/D2 mutations match confirm.sh exactly (`$VA if false`, `$VA | Right(ResourceAccess.Editor)`, `-> Right/provide(ResourceAccess.Editor)`, `getOrElse(Role.Editor)`, `case Some(_)`).
- Line hints re-derived by grep on the live tree: PanelService:221, DashboardContentsService:148, DashboardService:254, AccessCheckerImpl:83, AclDirective:141, ResourcePermissionRepository:36, PipelineRunService:194/197, OutputService:140 — all match.
- Design "facts checked" against the code, read in full:
  - Site 1 `batchUpdate`: 404 (missing panel) and 400 (mixed dashboards) arms precede `requireAccess`; no owner short-circuit; owner reaches `Right(_)` via `ResourceAccess.Owner`. `PanelRepository.findById` (:130) includes a dashboard-grantee predicate, so viewer/editor grantees do reach the gate (the viewer test will not short-circuit at 404).
  - Sites 2/3: owner short-circuit `existing.ownerId == user.id` / `d.ownerId == user.id` exists; removing it sends the owner to `requireAccess` -> `Owner` -> `Right(_)`, so the design is right that this is an equivalent mutant and correctly instructs recording it as such and killing the owner test on an arm the owner actually reaches.
  - Site 4: `None` user arm `hasPublicViewerGrant true -> Right(ResourceAccess.Viewer)`; `AccessCheckerImplSpec` already has a stub with a `hasPublicGrant` knob (`makePermRepo`), so the exact `Right(Viewer)` test is cheap; Editor-mapping mutation is killed by exact equality.
  - Site 5: :141 is the anonymous, no-public-grant, `tokenAuthorizes == true` arm (distinct from :124 grant-less user and :137 public grant, which HEL-1482 recorded killed). `ShareTokenValidator` is a trait and `AclDirective` takes `shareTokenValidator: Option[ShareTokenValidator]`, so a stub is straightforward; `access.toString` of the case object yields exactly `"Viewer"`/`"Editor"`, so `shouldBe "Viewer"` kills the mutation (the existing `should include("Viewer")` pattern is correctly called out as too weak).
  - Site 6: V16 `role VARCHAR(20) NOT NULL CHECK (role IN ('viewer','editor'))`; no later migration alters it (grep of migrations touching `resource_permissions`). `VerifiedEmbeddedPostgres.start` creates a fresh data directory and cluster per call (testkit source), and exposes the superuser connection, so dropping the CHECK in a dedicated spec cannot contaminate other specs. The D4 decision (test + comment, with a documented fallback that never loosens main code) is sound and satisfies AC1 either way.
  - Site 7: owner -> run; non-owner -> `findGrantRole` (`withSystemContext` raw role string) -> `Some("editor")` run, `case _` -> `Forbidden("Forbidden")`. Owner mutation `!= -> true` sends the owner to `findGrantRole` -> `None` -> Forbidden, so it is NOT equivalent and kills an owner-accept test. Accept tests are practical without Spark: `PipelineRunServiceSpec` already has `seedGrantee(pid, "editor")` real- and dry-run editor tests (:521, :535) — these are what killed HEL-1482's editor mutation (`P1-PipelineRunService-E.log`: 2 FAILED).
  - Site 8: name/kind/config validation precede the gate; Viewer -> `Forbidden()`; owner reaches `Right(_)`. Existing "should let an editor grantee create an Output" kills E (`P7-OutputService140-E.log`).
  - Owner-rejecting mutations of the form `case Right(_) =>` -> `case Right(ResourceAccess.Editor) =>` compile (Scala 2.13.15; no fatal-warnings/`-Werror` in `build.sbt`), and produce a MatchError failed Future -> owner test red.
  - Stale citations: `PipelineCreateTransaction.scala:32` and `PipelineRootWrites.scala:30` cite `resolveRootDataSources`; grep of `backend/src` finds only these two. `PipelineRootWrites.resolveOneRootSourceId` (:36) and `PipelineCreateWrites.lookupOwnedRoots` (:195) exist.
  - `[hel1468-guard]` line exists (`backend/project/ScalaTestSummaryGuard.scala:78`).
- Assertion strength: D1 requires exact `ServiceError` values / exact status+body, and accept tests must observe an effect; this rules out the "200-with-failure" weakening. AC1–AC6 each map to a task (2.x/3.x/4.x -> AC1–3, 5.1 -> AC4, 6.1 -> AC5, escalation rule -> AC6).

### Verdict: CONFIRM

### Non-blocking notes

- Site 7: the natural harness is `PipelineRunServiceSpec` (existing `seedGrantee` + no-Spark editor run tests), not only the `PipelineRunRoutesSpec`/`PipelineRunGuardIntegrationSpec` the design names as fallback. Note that harness's editor tests say "despite no persisted run row", i.e. `pipelineRunRepo` may be absent there, so the viewer test's "no run row created" check could be vacuous in it — the exact `Left(ServiceError.Forbidden("Forbidden"))` must stay the primary assertion, and the editor/owner accept effect should be the returned `RunResultResponse` (or a run row only where a repo is wired).
- Site 6: the V16 CHECK is unnamed; look its name up from `pg_constraint` (or `ALTER TABLE ... DROP CONSTRAINT` the auto-generated `resource_permissions_role_check` after confirming it) rather than assuming.
- Owner kills via `case Right(_) -> case Right(ResourceAccess.Editor)` surface as a MatchError failed Future; record the RED excerpt so the failure is attributable to the owner test (not an unrelated abort).
- Sites 2/3: if the owner test is killed by turning the short-circuit's `Right(...)`/export into `Left(ServiceError.Forbidden())`, record the `!= true`/`== false` variant as equivalent explicitly, as the design already says.
