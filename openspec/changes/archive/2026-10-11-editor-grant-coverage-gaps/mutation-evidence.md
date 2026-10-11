# HEL-1488 mutation evidence

Method: HEL-1482's `mutl.py` (copied to `.concertino/runs/HEL-1488/evidence/`, repointed; never committed) applies a
one-line, line-scoped, exactly-one-occurrence replace, runs the targeted spec with `nice -n 19 sbt -batch -J-Xmx3g`,
and always reverts. Raw logs: `/home/matt/Development/helio/.concertino/runs/HEL-1488/evidence/<id>.log`
(`s1238.sh` is the driver for sites 1/2/3/8). Unmutated runs: `s7-unmutated.log` (91/91), `s1238-unmutated.log`
(12/12), `s45-unmutated.log` (24/24), `s6-unmutated.log` (1/1), all showing `[hel1468-guard] ... failed=0`.
"Test" is the new test that turned red; every mutated run was otherwise green except as listed.

| Site | Id | File:line | One-line mutation | RED (killer) | Unmutated |
|---|---|---|---|---|---|
| 7 viewer | S7-V | PipelineRunService:197 | `case Some("editor")` -> `case Some(_)` | 2 killers: viewer real run + viewer dry run (PipelineRunServiceSpec) | green |
| 7 editor | S7-E | PipelineRunService:197 | `case Some("editor")` -> `case Some("editor") if false` | 4 killers: the 2 pre-existing editor tests + new editor dry/real run response tests | green |
| 7 owner | S7-O | PipelineRunService:194 | guard `pipeline.ownerId.value != user.id.value` -> `true` | 51 killers, e.g. `Left(Forbidden("Forbidden")) was not an instance of Right` | green |
| 1 viewer | S1-V | PanelService:221 | `Right(ResourceAccess.Viewer)` -> `... if false` | viewer: `Right(Vector(DividerPanel(... "Edited by viewer" ...))) was not equal to Left(Forbidden("Forbidden"))` | green |
| 1 editor | S1-E | PanelService:221 | `$VA` -> `$VA \| Right(ResourceAccess.Editor)` | editor batch update | green |
| 1 owner | S1-O | PanelService:223 | `case Right(_)` -> `case Right(ResourceAccess.Editor)` | owner: `scala.MatchError: Right(Owner)` at PanelService.scala:218 | green |
| 2 viewer | S2-V | DashboardContentsService:148 | `$VA` -> `$VA if false` | viewer contents replace | green |
| 2 editor | S2-E | DashboardContentsService:148 | `$VA` -> `$VA \| Right(ResourceAccess.Editor)` | editor contents replace | green |
| 2 owner (equiv.) | S2-O-equiv | DashboardContentsService:143 | `existing.ownerId == user.id` -> `false` | NONE: 12/12 pass. EQUIVALENT mutant: the owner falls through to `requireAccess` -> `Owner` -> `Right(_)` | green |
| 2 owner | S2-O | DashboardContentsService:144 | owner short-circuit `Right(())` -> `Left(ServiceError.Forbidden())` | `expected the owner's contents replace to be accepted` | green |
| 3 viewer | S3-V | DashboardService:254 | `$VA` -> `$VA if false` | viewer export | green |
| 3 editor | S3-E | DashboardService:254 | `$VA` -> `$VA \| Right(ResourceAccess.Editor)` | editor export | green |
| 3 owner (equiv.) | S3-O-equiv | DashboardService:246 | `d.ownerId == user.id` -> `false` | NONE: 12/12 pass. EQUIVALENT mutant (same reason as site 2) | green |
| 3 owner | S3-O | DashboardService:249 | owner arm `Right(value)` -> `Left(ServiceError.Forbidden())` | `expected the owner's export to be accepted` | green |
| 8 viewer | S8-V | OutputService:140 | `$VA` -> `$VA if false` | viewer Output create | green |
| 8 editor | S8-E | OutputService:140 | `$VA` -> `$VA \| Right(ResourceAccess.Editor)` | editor Output create | green |
| 8 owner | S8-O | OutputService:141 | `case Right(_)` -> `case Right(ResourceAccess.Editor)` | owner: `scala.MatchError: Right(Owner)` at OutputService.scala:138 | green |
| 4 | S4-publicV | AccessCheckerImpl:83 | public-viewer arm `Right(Viewer)` -> `Right(Editor)` | `Right(Editor) was not equal to Right(Viewer)` | green |
| 5 | S5-token | AclDirective:141 | `provide(ResourceAccess.Viewer)` -> `provide(ResourceAccess.Editor)` | `"[Edito]r" was not equal to "[Viewe]r"` | green |
| 6 | S6-fallback | ResourcePermissionRepository:36 | `getOrElse(Role.Viewer)` -> `getOrElse(Role.Editor)` | `Some((...,Editor)) was not equal to Some((...,Viewer))` | green |

Notes:
- Site 6 decision (design D4): TESTED, not just documented. `ResourcePermissionRoleFallbackSpec` has its own
  `VerifiedEmbeddedPostgres` cluster, first asserts the unknown role is rejected by V16's CHECK (so the arm is unreachable in
  production), looks the unnamed CHECK up in `pg_constraint` (no assumed name), drops it, inserts role `'owner'`, and
  asserts `findGrant` returns exactly that grant with `Role.Viewer`. A comment at the fallback records the same.
- Sites 7 editor/accept: a non-owner's run persists no `pipeline_runs`/assertion row (existing behaviour), so the
  accept effect is the returned `RunResultResponse` (`rowCount == 2`, `sourceRowCount == 2`, `blocked == false`).
  The viewer assertion is the exact `Left(ServiceError.Forbidden("Forbidden"))`; the "no run row" checks are secondary.
- Equivalent owner short-circuit mutants (sites 2 and 3) are recorded as equivalent, not "killed"; the owner tests are
  killed by the owner-rejecting mutants above.
- No test failed on unmutated code; no authorization defect found.
