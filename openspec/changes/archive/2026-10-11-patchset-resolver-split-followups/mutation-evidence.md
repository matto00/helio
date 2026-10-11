# Mutation evidence (HEL-1482, design D1-D5)

Run scripts and raw logs: `/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/` (not committed). Every mutation
is a one-line, line-scoped replace applied by `mut.py` / `mutl.py` and reverted in a `finally`; `git diff -- backend/src/main`
after every batch showed no residue, and the final diff is comment-only (`verification.md`). Every sbt run: `nice -n 19 sbt -batch
-J-Xmx3g`, each log carries the `[hel1468-guard]` line. Unmutated control logs: `grant-unmutated.log`, `dashgrant-unmutated.log`,
`messages-unmutated.log`, `M4-green.log`.

Entry points used: new specs drive `PatchSetApplyService.apply` and `PatchSetPreviewService.preview` directly (service level, the
`Left(ServiceError.Forbidden())` the route maps to HTTP 403); the message helpers are pure and are called directly.

## Item 7 - `PatchSetPipelineStepGrantSpec` (9 tests) against `authorizeEditorOrOwnerOnPipeline`

Unmutated: 9/9 green (behaviour equals the REST step rule: owner or editor allowed, viewer 403). No escalation needed.

| Mut | One-line change (`PatchSetApplyResolvers.scala`) | Result |
|---|---|---|
| M7a weaken | `case Some("editor") => Right(())` -> `case Some(_) => Right(())` | RED, 4 failed: the four viewer tests, e.g. `Right(PatchSetApplyResponse(Vector(), Some("Forbidden"), None)) was not equal to Left(Forbidden("Forbidden"))` - proves the design note: under the weakened gate a viewer apply ends as `Right(failure=Forbidden)` (HTTP 200), only the exact `Left` goes red. Log `M7a.log`. |
| M7b tighten | `case Some("editor") => Left(ServiceError.Forbidden())` | RED, 4 failed: editor update / delete / create / preview-update. `M7b.log` |
| M7c owner | `pipeline.ownerId == user.id` -> `false` | RED, 1 failed: `apply a pipelineStep update with no grant at all` (owner path). `M7c.log` |

Each mutation was reverted by the runner; the final `testFull` on the reverted tree (below) is green with all three new specs.

## Item 7 audit - dashboard branches, `PatchSetDashboardGrantSpec` (9 tests, added because the audit found survivors)

The first audit pass (`D1`/`D2` below) survived on the existing patch-set specs, so `PatchSetDashboardGrantSpec` was added. Unmutated 9/9 green
(`dashgrant-unmutated.log`).

| Mut | Change | Result with the new spec |
|---|---|---|
| R-D1-V `resolveDashboardUpdate` viewer let-through | `Right(ResourceAccess.Viewer)` -> `... if false` | RED 2: viewer dashboard update (apply, preview) |
| R-D1-E editor rejected | `Right(ResourceAccess.Viewer) \| Right(ResourceAccess.Editor)` | RED 2: editor dashboard update (apply, preview) |
| R-D2-V `authorizeEditorOnDashboard` viewer let-through | `... if false` | RED 3: viewer panel update / delete / create |
| R-D2-E editor rejected | `\| Right(ResourceAccess.Editor)` | RED 2: editor panel delete / create (the editor update case was already red from the existing 7.4b test) |

## Items 5-6 - `PatchSetResolverMessagesSpec` (6 tests)

| Mut | Change | Result |
|---|---|---|
| M5 `requireTargetId` | drop `for op '${edit.op}'` from the message | RED 2: absent id (op `update`, index 1), blank id (op `delete`, index 2) |
| M6a `decodeCreatePatch` missing patch | `patch is required for a create edit` -> `patch is required` | RED 1 |
| M6b `decodeCreatePatch` wrong shape | `patch does not match the expected shape (` -> `patch is malformed (` | RED 1 |

Reachability: the two helpers run before any repository call and their callers only forward the `Left`, so they are tested directly
(deepest reachable entry point, full `BadRequest` text, non-zero edit index so the `edit <i>:` interpolation is pinned). The wrong-shape
test asserts `startWith("edit 1: patch does not match the expected shape (")` and a `BadRequest` status (the suffix is the spray-json exception text).

## Item 4 - `ExistenceNotLeakedRoutesSpec` output rows

The four `output update|delete` rows (apply and preview) now name `PatchSetOutputResolvers.scala`; nothing else in the file changed.
Unmutated: 61/61 green including the completeness guard (`M4-green.log`).

M4: `PatchSetOutputResolvers.findOwnedOutput`, `case Some(output) if output.ownerId != user.id => Left(NotFound(...))` -> `if false`
(a foreign id gets through): RED 4 of 61, exactly the four rows `get an identical 404 for a foreign and a nonexistent id: POST patch-set
apply|preview: output update|delete`; the other 57 (incl. the completeness guard) stay green. `M4.log`.

## Editor-grant audit (D3)

Re-derived by grep over `backend/src/main/scala` for `findGrantRole`, `Some("editor")`, `.contains("editor")`,
`ResourceAccess.Viewer|Editor`, `Role.Viewer|Editor` (non-comment lines): every hit is in the table (the definition and fallback sites included).
V = let a viewer through, E = reject an editor (applied where a separate editor-accept arm exists; where the accept arm is a wildcard
`Right(_)` the E mutation adds `| Right(ResourceAccess.Editor)` to the viewer-rejecting arm). "sel" = the selected targeted specs
(dashboards/panels/ACL set or pipelines set, plus `ExistenceNotLeakedRoutesSpec` and the patch-set specs, ~295 / ~443 tests);
"full" = `testFull` (6690 tests) confirmation run for every sel-survivor.

| Site | V | E | Note |
|---|---|---|---|
| `PatchSetApplyResolvers` `resolveDashboardUpdate` (patchsets) | sel SURVIVED -> **killed by new spec** | sel SURVIVED -> **killed by new spec** | gap fixed here |
| `PatchSetApplyResolvers` `authorizeEditorOnDashboard` (patchsets) | sel SURVIVED -> **killed by new spec** | killed (existing 7.4b) + new spec | gap fixed here |
| `PatchSetApplyResolvers` `authorizeEditorOrOwnerOnPipeline` (patchsets) | M7a killed | M7b killed (+ M7c owner) | gap fixed here (item 7) |
| `PanelService` ~:144 create | killed (2) | killed (2) | |
| `PanelService` ~:221 batch update | **SURVIVED full** (`F-D5-V`) | **SURVIVED full** (`F-D5-E`) | follow-up |
| `PanelService` ~:279 batch create | killed (1) | killed (2) | |
| `PanelService` ~:317 `authorizeEditorOnDashboard` | killed by `ServiceError.Forbidden` producer-count guard only under the sel mutation (`Forbidden()` -> `Right(())`); a count-preserving mutation (`F-D7-V`) is killed behaviourally by `prevent a viewer from patching a panel` under full | killed (2) | not a gap; note the guard-only kill |
| `AutoLayoutService` ~:143 | killed (1) | killed (1) | |
| `DashboardContentsService` ~:148 | **SURVIVED full** (`F-D8-V`) | **SURVIVED full** (`F-D8-E`) | follow-up |
| `DashboardService` ~:202 update | killed (1) | killed (1) | |
| `DashboardService` ~:254 `exportSnapshot` (viewer is Forbidden) | **SURVIVED full** (`F-D10-V`) | killed (1, `batch-create` editor test) | follow-up (V) |
| `AccessCheckerImpl` :74 `Role.Editor -> Editor` | n/a | killed (7) | |
| `AccessCheckerImpl` :75 `Role.Viewer -> Viewer` | killed (6) | n/a | |
| `AccessCheckerImpl` :83 public-viewer arm | **SURVIVED full** (`F-D13`) mapped to Editor | n/a (no editor arm) | follow-up |
| `AclDirective` :118 `Role.Editor` | n/a | killed (2) | |
| `AclDirective` :119 `Role.Viewer` | killed (1) | n/a | |
| `AclDirective` :124 token-authorized `provide(Viewer)` (grant-less user) | killed (1) | n/a | token read arm |
| `AclDirective` :137 public-grant `provide(Viewer)` (anonymous) | killed (1) | n/a | public read arm |
| `AclDirective` :141 token-authorized `provide(Viewer)` (anonymous) | **SURVIVED full** (`F-D18`) mapped to Editor | n/a | token read arm; follow-up |
| `ResourcePermissionRepository` :36 `getOrElse(Role.Viewer)` fallback | **SURVIVED full** (`F-D19`) `Role.Editor` | n/a | fail-closed default for an unknown role string; the grant table's role set is closed, so no test can reach it; follow-up decides (test or accept) |
| `PipelineRunService` ~:197 submit | **SURVIVED full** (`F-P1-V`) | killed (2) | viewer-triggers-run gap; follow-up |
| `PipelineRunPreview` ~:247 | killed (1) | killed (1) | |
| `PipelineAnalyzeReads` ~:143 `canRun` | sel survived; **killed by full** (`F-P3-V`, 2 tests) | sel survived; **killed by full** (`F-P3-E`, 1 test) | not a gap (the specs that kill it were outside the selected set) |
| `AutoRunTriggerService` ~:145-146 | killed (1) | killed (1) | |
| `ApiTokenService` ~:102 | killed (1) | killed (1) | |
| `OutputService` ~:140 create | **SURVIVED full** (`F-P7-V`) | killed (1) | follow-up (V) |
| `PipelineService.requireEditorAccess` ~:253 | sel survived; **killed by full** (`F-P5-V`: step reorder / duplicate viewer 403) | killed (3) | not a gap for the helper; note `updateStep`/`deleteStep` viewer-403 on REST are only killed through the other callers |
| `PipelineRepository.findGrantRole` definition (`.map(_.role)`) | killed (7) `_ => "editor"` | killed (9) `_ => "viewer"` | |

### Survivors outside `services/patchsets/` (NOT tested here; for the orchestrator's follow-up ticket)

1. `PanelService` ~:221 (batch update): viewer let-through AND editor-rejected both survive `testFull`.
2. `DashboardContentsService` ~:148 (`PUT /api/dashboards/:id/contents`): viewer let-through and editor-rejected both survive.
3. `DashboardService.exportSnapshot` ~:254: viewer let-through survives (editor-rejected is killed).
4. `AccessCheckerImpl` :83: the public-viewer arm mapped to `Editor` survives (anonymous `requireAccess` callers).
5. `AclDirective` :141: the anonymous token-authorized arm mapped to `Editor` survives.
6. `ResourcePermissionRepository` :36: the unknown-role fallback `Role.Viewer` -> `Role.Editor` survives (probably unreachable).
7. `PipelineRunService.submit` ~:197: a viewer grantee may trigger a run - survives (editor-rejected is killed).
8. `OutputService` ~:140 (create Output): viewer let-through survives (editor-rejected is killed).

Code reading of each (the grant-role arm is the one the REST docs describe: viewer sees, editor mutates) shows the production behaviour is
the intended one; these are missing-coverage findings, not authorization defects, so no ESCALATION is raised for them.
