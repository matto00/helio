## Context

See proposal.md and ticket.md. Base: origin/main bcb0e8919 (HEL-1482 merged as 5f0b679ef). HEL-1482's method and raw
evidence: `openspec/changes/archive/2026-10-11-patchset-resolver-split-followups/` (design.md D1/D3,
mutation-evidence.md) and `/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/` (`mut.py`, `mutl.py`,
`confirm.sh`, `F-*.log`). `confirm.sh` holds the exact surviving one-line mutations for every site below. Paths are
relative to `backend/`; `S=src/main/scala/com/helio/`.

Facts checked while planning on bcb0e8919 (re-verify; they are claims, including the driver's):
- Site 1 `S/services/panels/PanelService.scala` `batchUpdate` (~:218-224): `requireAccess("dashboard", ...)` then
  `Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())`, `Right(_) => batchWrites.updateValidated(...)`.
  Owner, editor and viewer all reach this match (no owner short-circuit). Panels must exist and share one dashboard
  first (404 / 400 arms before it).
- Site 2 `S/services/dashboards/DashboardContentsService.scala` `authorizeEditor` (~:140-151) used by
  `replaceContents` (`PUT /api/dashboards/:id/contents`): `findById` None -> 404; owner short-circuit -> Right;
  else `requireAccess`, Viewer -> `Forbidden()`, `Right(_)` -> Right.
- Site 3 `S/services/dashboards/DashboardService.scala` `exportSnapshot` (~:239-260): same shape; owner
  short-circuit; non-owner Viewer -> `Forbidden()`; `Right(_)` -> `dashboardRepo.exportSnapshot`.
- Site 4 `S/api/http/AccessCheckerImpl.scala` (~:81-85): `userOpt = None` -> `hasPublicViewerGrant` true ->
  `Right(ResourceAccess.Viewer)`, false -> `NotFound(notFoundMessage)`. `AccessCheckerImplSpec` (stubbed
  `ResourcePermissionRepository(null)` subclass) already exists.
- Site 5 `S/api/http/AclDirective.scala` `authorizeResourceWithSharing` (~:136-142): `userOpt = None`, no public
  grant, `tokenAuthorizes` true -> `provide(ResourceAccess.Viewer)`. `AclDirectiveSpec` and
  `ShareTokenAuthenticatedAccessSpec` exist. Note: existing `AclDirectiveSpec` asserts `should include("Viewer")`;
  new assertions must be exact (`responseAs[String] shouldBe ...`), see D1.
- Site 6 `S/infrastructure/persistence/auth/ResourcePermissionRepository.scala` `rowToDomain` (:36):
  `Role.fromString(row.role).getOrElse(Role.Viewer)`. V16 declares `role VARCHAR(20) NOT NULL CHECK (role IN
  ('viewer', 'editor'))`, so the fallback is unreachable through any write the app or schema permits.
- Site 7 `S/services/pipelines/PipelineRunService.scala` `submit` (~:190-205): non-owner -> `findGrantRole`;
  `Some("editor")` -> run; `case _` -> `Left(ServiceError.Forbidden("Forbidden"))`. Owner -> run.
- Site 8 `S/services/pipelines/OutputService.scala` `create` (~:124-145): after name/kind/config validation,
  `requireAccess("pipeline", ...)`; Viewer -> `Forbidden()`; `Right(_)` -> insert.
- Stale citations: `S/services/pipelines/PipelineCreateTransaction.scala:32` and
  `S/services/pipelines/PipelineRootWrites.scala:30` cite `resolveRootDataSources` (does not exist). Real symbols:
  `PipelineRootWrites.resolveOneRootSourceId` (blank/absent id -> 400) and `PipelineCreateWrites.lookupOwnedRoots`
  (unowned -> 404). Read each comment's sentence to pick which one (or both) it means.

## Goals / Non-Goals

Goals: each of the eight sites pinned by failable tests (viewer/editor/owner where each applies), exact assertions,
red-first by mutation; site 6 decided; two citations fixed. Non-goals: any behaviour change (C1); re-auditing sites
HEL-1482 recorded as killed; editing archived evidence.

## Decisions

**D1 - Red-first by mutation, exact assertions.** Code is believed correct, so "red first" = apply a one-line
mutation to the exact branch the test guards, run the targeted spec, show it RED with an attributable failure
excerpt, revert, show GREEN. Reuse HEL-1482's `mut.py`/`mutl.py` (copied into
`/home/matt/Development/helio/.concertino/runs/HEL-1488/evidence/` with `W`/`E` repointed to this worktree/run;
never committed). The viewer and editor mutations for each site are exactly those in HEL-1482's `confirm.sh`
(`$VA if false` / `$VA | Right(ResourceAccess.Editor)` / `-> Editor` / `case Some(_)`). Additional mutations needed
for the editor/owner tests at sites without a recorded one (D2) are one line each and recorded. Record every
mutation in `mutation-evidence.md` in the change dir: site, one-line change, test(s), RED excerpt, GREEN.
Assertion strength: exact `Left(ServiceError.Forbidden(...))` / `Left(ServiceError.NotFound(...))` values from the
service, or exact HTTP status AND body at the route/directive; an accept test asserts the exact `Right` shape it can
(or `isRight` plus an observed effect re-read from the DB: changed panel field, replaced contents, exported payload
containing the dashboard, a run row/result, an inserted Output). Never "not 2xx" or "nothing mutated" alone
(HEL-1482 lesson: a weakened gate can surface as 200 with a `failure` field).

**D2 - Per-site tests.** Service-level, through the public service method each route calls (the route maps
`Forbidden` -> 403); the executor may test at the route instead where the harness is simpler, and states which.
New spec files use `VerifiedEmbeddedPostgres.start` (same harness shape as the nearest existing spec for that
service, e.g. `PatchSetDashboardGrantSpec`/`PatchSetPipelineStepGrantSpec` from HEL-1482 for grant setup via a
`resource_permissions` row). Owner A owns the resource; B is granted `editor` or `viewer`.
- Site 1 PanelService.batchUpdate: viewer -> exact `Left(Forbidden())` and panel unchanged; editor -> Right, panel
  field changed (re-read); owner -> Right, changed. Mutations: V `$VA if false`; E `$VA | Right(ResourceAccess.Editor)`;
  owner: `case Right(_) =>` -> `case Right(ResourceAccess.Editor) =>` (owner falls to MatchError / not accepted) or
  another one-line owner-rejecting change on the arm the owner actually reaches - record which.
- Site 2 DashboardContentsService.replaceContents: viewer exact `Left(Forbidden())`; editor Right + contents
  replaced; owner Right. V/E as HEL-1482. Owner: `existing.ownerId == user.id` -> `false` is expected to be an
  EQUIVALENT mutant (owner falls through to requireAccess -> Owner -> `Right(_)`); if so record it as equivalent and
  kill the owner test with a one-line change on the arm it then reaches, or with the short-circuit returning
  `Left(Forbidden())` - record which.
- Site 3 DashboardService.exportSnapshot: viewer exact `Left(Forbidden())`; editor Right (payload for that
  dashboard); owner Right. V `$VA if false`; E `$VA | Right(ResourceAccess.Editor)`; owner as site 2.
- Site 4 AccessCheckerImpl: `requireAccess(type, id, None, msg)` with a public viewer grant -> exactly
  `Right(ResourceAccess.Viewer)`; without -> exactly `Left(NotFound(msg))`. Mutation: arm -> `Right(ResourceAccess.Editor)`.
  Adding to the existing stubbed `AccessCheckerImplSpec` is acceptable (not a new spec file).
- Site 5 AclDirective: anonymous, no public grant, a validator that authorizes -> inner route sees exactly
  `ResourceAccess.Viewer` (assert exact response body, e.g. `shouldBe "Viewer"`, and 200); validator that refuses ->
  404 with the exact not-found body. Mutation: `provide(ResourceAccess.Viewer)` at that arm -> `provide(ResourceAccess.Editor)`.
  Stubs/existing spec acceptable (as site 4).
- Site 7 PipelineRunService.submit (priority, do first): viewer grantee -> exactly
  `Left(ServiceError.Forbidden("Forbidden"))` and no run row created; editor grantee -> accepted (a run result /
  run row; a dry run `isDry=true` is fine if it avoids Spark); owner -> accepted. Mutations: V `case Some("editor")`
  -> `case Some(_)`; E `case Some("editor")` -> `case Some("editor") if false`; owner
  `pipeline.ownerId.value != user.id.value` -> `true` is expected to send the owner to `findGrantRole` (None) ->
  Forbidden - record. If the run machinery makes an accept test impractical at service level, use the harness
  `PipelineRunRoutesSpec`/`PipelineRunGuardIntegrationSpec` already use, and state it.
- Site 8 OutputService.create: viewer exact `Left(Forbidden())` and no Output inserted; editor Right + Output exists;
  owner Right. V `$VA if false`; E `$VA | Right(ResourceAccess.Editor)`; owner via the arm it reaches (requireAccess
  -> Owner -> `Right(_)`), e.g. `case Right(_) =>` -> `case Right(ResourceAccess.Editor) =>` - record.
**Escalation rule (owner instruction):** if any viewer/editor/owner test fails against UNMUTATED code because the
behaviour differs from the documented rule (viewer reads only, editor mutates, owner everything; anonymous
public/token access is read-only Viewer), that is a real authorization bug: STOP, do not change the assertion or the
code, report it as `ESCALATION` with the exact repro (test name, inputs, observed vs expected).

**D3 - (reserved; no ordering beyond: site 7 first, then 1, 2, 3, 8, 4, 5, 6, citations.)**

**D4 - Site 6 decision: test it, plus a comment.** The fallback is the fail-closed default for a role string the
code does not know (e.g. a future migration widening the CHECK before the code learns the role). Test: a dedicated
spec with its OWN `VerifiedEmbeddedPostgres.start` instance (it alters schema, so it must not share a cluster) drops
the V16 CHECK on `resource_permissions.role` (privileged connection), inserts a grant row with role `'owner'` (or
another unknown string), and asserts `ResourcePermissionRepository.findGrant` returns exactly that grant with
`role == Role.Viewer`. Mutation: `getOrElse(Role.Viewer)` -> `getOrElse(Role.Editor)` -> RED. Add a comment at :36
stating the fallback is unreachable under V16's CHECK and is a fail-closed default pinned by the spec (name it).
Fallback if dropping the constraint is impractical in the harness (e.g. RLS/ownership blocks it): document only (the
comment) and record why in `mutation-evidence.md`; do not loosen anything in main code to make it reachable.

**D5 - Citations.** Repoint the two `resolveRootDataSources` comment citations to the real symbol(s) by symbol +
file, no line numbers, matching the sentence's meaning (400 shape error vs 404 unowned). Grep `backend/src` for any
other `resolveRootDataSources` hit and fix it the same way; record hits. Comment text only.

**D6 - Gates.** `nice -n 19 sbt -batch -J-Xmx3g` (one-shot batch, no sbt server left running); MemAvailable >= ~15 GB
(`grep MemAvailable /proc/meminfo`) before every `testFull` or full jest run, otherwise wait; at most two `testFull`
machine-wide (check for other lanes' running sbt via `ps -eo pid,args` - never pgrep/pkill); output must show the
`[hel1468-guard]` line. Targeted spec runs for red/green; one final `testFull` green with per-suite counts for touched
suites vs base in `test-count-evidence.md` (new tests are the only increase). `npm run check:scala-quality` passes. No
inline FQNs. `git diff <base>...HEAD -- backend/src/main` is comment-only, proven by a non-comment-line filter
(as HEL-1482 `verification.md`), recorded in `verification.md`. Gate logs live in the run evidence dir.

**D7 - Dev-DB residue.** Specs use their own embedded Postgres; nothing is written to the shared dev DB. If any
manual probe against the dev DB is ever needed, capture created ids first and delete by exact id; never touch the
owner's account.

## Risks / Trade-offs

- A test may expose a real authorization bug: handled by D2's escalation rule (park, not fix).
- Owner short-circuit mutants may be equivalent (owner reaches `Right(_)` via requireAccess anyway); recorded as
  equivalent, not "killed".
- Site 6's test depends on altering the schema in a private cluster; the D4 fallback keeps the ticket deliverable.
