## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b72fc12e8c3aa03c5e54ed1b0fdcc95069b14839` (change commit 58945eda0 plus a clean merge of origin/main).
Base resolved live: `resolve-review-base.sh` gave `c587643384d9ccb3b117dcbb5b9d4c2ca082fc70` (origin/main). I diffed against it.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/ghost-layout-followups/HEL-1485`.

### What I verified (with evidence)

**AC1, preview == apply for ghost items.**
- `LayoutPolicy.resolveOnLive` (LayoutPolicy.scala, new) holds the filter-then-resolve logic that used to be inline in
  `DashboardWrites.applyUpdate`. I compared it line by line: same `onlyPanels` on stored, same `onlyPanels` on the
  patch, same Validate/RestorePriorStored branches. Both `DashboardWrites.applyUpdate` and
  `PatchSetPreviewProjection.dashboardUpdateAfter` now call it, so the two cannot drift.
- The preview's rename-only branch (`renameOnly = name defined && appearance empty && layout-patch empty`) matches
  apply's `writeUpdate`, which returns the stored row as-is when `appearanceOpt.isEmpty && layoutOpt.isEmpty`.
  `layoutOpt` is `Some` whenever a patch is supplied (`validateDashboardLayoutPayload` rejects an empty object), so the
  two conditions are the same.
- `PatchSetPreviewGhostLayoutSpec` compares the previewed layout with a real apply's `resultingState` (not hand-built
  JSON). Red evidence `evidence/red-preview-autolayout.log:235-240` fails for the right reasons: the ghost is present,
  the ghost item is kept, and the unfixed code returns 400 where apply returns 200. Green in my own run (below).

**AC2, deadlock reproduced and fixed.**
- `DashboardDeleteRacesPanelDeleteSpec` uses `LayoutStripDbSupport`, which calls `VerifiedEmbeddedPostgres.start` and
  runs as role `helio_migration_test` (NOSUPERUSER NOBYPASSRLS; the posture is asserted). The privileged side uses
  `SET ROLE helio_privileged`. The dashboard side runs the real `DashboardRepository.delete` and
  `WorkspaceTeardownRepository.teardown`. The 40P01 comes from the real V122 trigger plus the real FK cascade. The
  interleave waits until `pg_stat_activity.wait_event_type='Lock'` is observed (20 ms polling with a 20 s deadline;
  the sleep only paces polling and proves nothing). The scaladoc says the spec proves the cycle can form, not how often
  it happens (C1).
- Red evidence `evidence/red-deadlock.log:231-234`: `dashboard side=Some(40P01)` and `teardown side=Some(40P01)`, with
  `[hel1468-guard] failed=2`. Green: `green-deadlock.log`, and my own run.
- Fix: `DashboardRepository.lockPanelRows` (`panels WHERE dashboard_id IN … ORDER BY id FOR UPDATE`) runs first in
  `delete`, and first in teardown's write phase, before `deletePipelines`. That ordering is correct because the
  outputs→panels cascade fires V122.
- I checked independently for new inversions. I enumerated every transaction that locks a dashboard row and then
  touches panels:
  - `PanelLayoutPlacement.insertAndAppend` (create, batch create, duplicate) takes D `FOR UPDATE` and then inserts
    new panel rows only. An insert never waits on existing panel row locks, so it cannot form a cycle with the
    pre-lock.
  - `replaceContents` deletes panels before it updates D, so its order is already panel→dashboard.
  - `batchUpdate` touches panels only.
  - The snapshot duplicate/import paths create new rows.
  - No other `FOR UPDATE` or `dashboards` write precedes an existing-panel lock. The only `forUpdate` sites in backend
    main are PanelLayoutPlacement, PipelineStepRepository, ConnectorRepository and DataSourceRepository.
  - Result: no dashboard-then-existing-panel order exists anywhere, so the reorder introduces no new inversion. The
    remaining panel↔panel ordering (a multi-panel deleter or batchUpdate in non-id order) was already present: the
    cascade previously locked panels in scan order. It is documented in code and in `probe-deadlock.md`.

**AC3, auto-layout filter.** `AutoLayoutService` now reads `panelIdsInternal` and packs against
`LayoutPolicy.onlyPanels(existing.layout, livePanelIds)`. It uses that filtered layout both as the base of `kept` and
as the `existing` passed to `LayoutPolicy(...)`, so untargeted breakpoints are written back filtered. The unknown-panel
400 still comes from `findAllByDashboardId`. The remaining HEL-1457 window is commented. Red evidence
`red-preview-autolayout.log:473-476`: the ghost is kept, and the ghost is written to an untargeted breakpoint. Green in
my run.

**AC4, undo-check refactor.** `DashboardResponse.fromDomain` copies `name` unchanged. `DashboardLayoutResponse`,
`DashboardLayoutItemResponse` and `DashboardAppearanceResponse` all map field for field
(DashboardProtocol.scala:114-180). The old domain→response→domain round trip was therefore lossless, and comparing
`liveDashboard.layout` directly is equivalent. Existing undo specs pass unchanged (my run).

**AC5 / C2.**
- `git diff --stat <base>...HEAD -- backend/src/main/resources` is empty. The newest migration is still V123, and no
  migration was added.
- I grepped the added Scala lines that are not imports for `com|java|scala|org|slick.x.Y`. The only hits are `package`
  declarations, so there are no inline FQNs.
- `[hel1468-guard]` is present in every sbt log.

**My own gate run.** `nice -n 19 sbt -J-Xmx3g` `testOnly` over 12 specs: the 3 new ones, plus PatchSetUndoGhostLayout,
UndoPanelDashboard, UndoRoutes, UndoRefusal, AutoLayoutRoute, PatchSetPreviewRoutes, DashboardLayoutGhostWrite,
V122StripDeletedPanelLayoutItems and PanelDeleteLayoutStripConcurrency.
- Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`,
  `Tests: succeeded 72, failed 0`, exit 0.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1485/evidence/skeptic-final-targeted.log`. I shut the sbt
  server down afterwards.
- The evaluator's `eval2-testFull.log:77538-77543` shows the full suite at this head: `succeeded 6854, failed 0`,
  `failed=0` guard line.

**UI.** No `frontend/**` changes, so the visual review step does not apply.

**User-visible behaviour.**
- No new product behaviour. The preview now shows the layout apply actually stores, which is the AC.
- Auto-layout no longer re-stores items for panels that no longer exist; ghost items never rendered as panels.
- In the dashboard-delete vs panel-delete race, both requests now succeed where one used to fail with 40P01.
- The only observable difference is latency: a dashboard delete may now wait on a concurrently locked panel row
  instead of on the cascade. No assumed product call.

### Verdict: CONFIRM

### Non-blocking notes
- Undo check: `liveDashboard.name == journaled.name` relies on `fromDomain` not normalising the name. True today. If
  `fromDomain` ever trims names, this path would diverge silently.
- The residual panel↔panel ordering and the teardown untagged-dashboard case are follow-up candidates. Both are
  recorded in `probe-deadlock.md`. Make sure the PR body carries them, as design.md requires.
- `evaluation-1.md` and `evaluation-2.md` are untracked in the worktree. Delivery should decide whether to commit them
  with the change dir.
