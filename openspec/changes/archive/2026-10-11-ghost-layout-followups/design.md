## Context

HEL-1456 (archive `openspec/changes/archive/2026-10-10-strip-deleted-panel-layout-entries/`) added:
- V122: statement-level `AFTER DELETE ON panels` trigger, SECURITY DEFINER owned by `helio_privileged`, that locks the
  affected dashboards `FOR UPDATE ORDER BY id` and strips the deleted panels' items. Its header and HEL-1456 D3 claim a
  single lock order "panel rows, then dashboards".
- `DashboardWrites.applyUpdate` (D5): `dashboardRepo.panelIdsInternal` (privileged, unpaged) then
  `LayoutPolicy.onlyPanels` on BOTH the stored layout and the supplied patch breakpoints before `LayoutPolicy(...)`.
- `PatchSetUndoConflictCheck.checkDashboard` (D7): compares live vs journaled layouts over live panel ids.

Loose ends (HEL-1456 skeptic-final-1.md non-blocking notes, evaluator notes):
1. `PatchSetPreviewProjection.dashboardUpdateAfter` (~line 212-233) resolves `LayoutPolicy(prior.layout, patch)` with
   no filter, so a preview can show an item apply drops (and validate a ghost the apply would never validate).
2. Dashboard delete (`DashboardRepository.delete`, privileged pool; and `WorkspaceTeardownRepository`'s
   `deleteDashboards`) deletes the dashboard row first (row lock on D), then the V2 FK cascade deletes its panels
   (needs each panel row lock). A concurrent `DELETE` of panel P holds P's row lock, then V122 waits on `FOR UPDATE` D.
   Opposite orders: a 40P01 is plausible. Never reproduced.
3. `AutoLayoutService` builds `kept` from `LayoutPolicy.stored(existing.layout, bp)` with no live-panel filter and
   writes the full layout via `dashboardRepo.update`; a panel deleted after its unlocked read (V122 strips it) is
   written back as a ghost; so is any ghost present in the stored row.
4. `checkDashboard` converts `liveDashboard` to `DashboardResponse` and back to domain before `onlyPanels`.

## Goals / Non-Goals

**Goals:** preview == apply for ghost items; deadlock reproduced-or-refuted with evidence, fixed if real without a
user-visible change; auto-layout stores no ghost; the undo-check refactor; V122/V123 untouched.
**Non-Goals:** HEL-1457 LWW (the unlocked read-then-write window of PATCH and auto-layout stays); cross-edit sequential
preview (each edit is projected against its resolved stored prior, for every field — pre-existing); frontend.

## Decisions

**D1 — Preview reuses apply's filter.** `dashboardUpdateAfter` becomes Future-returning: it reads
`ctx.dashboardRepo.panelIdsInternal(prior.id)` and applies `LayoutPolicy.onlyPanels` to `prior.layout` and to the patch
(same two calls, same order, as `DashboardWrites.applyUpdate` under `LayoutWritePolicy.Validate`) before
`LayoutPolicy(...)`. Prefer extracting one small shared pure function (e.g. in `LayoutPolicy`/`DashboardWrites`'
companion: `(stored, patchOpt, panelIds, policy) => Either[String, Option[DashboardLayout]]`) that BOTH call, so they
cannot drift again; if extraction is awkward, mirror it and say why. The `after` JSON's layout is the filtered one even
when no layout patch is supplied (apply writes the filtered stored layout on an appearance-only update via
`writeUpdate`). Rename-only: apply writes only the name (`DashboardWrites.writeUpdate`) and returns the row as stored;
preview must match that branch too (unfiltered row) — state the parity in the test, and put a one-line comment on the
shared helper saying rename-only returns the stored layout unfiltered on purpose, so nobody "fixes" one side only.
Known residual (non-goal): an earlier edit in the same patch set that deletes/creates a panel can still make preview
differ from apply; the PR says so.
Red-first tests: (a) prior layout holds a ghost item, patch updates appearance only -> preview `after.layout` has no
ghost (matches apply's resultingState); (b) patch supplies a breakpoint naming a non-live panel -> preview drops it;
(c) a ghost whose rect overlaps a live item, sent in the patch -> preview does not 400 (apply does not). Compare preview
`after` to a real apply's `resultingState` for the same patch set where feasible (parity assertion, not hand-built JSON).

**D2 — Deadlock: reproduce first, then pre-lock panel rows on dashboard delete.**
Repro (red-first): a DB spec on `VerifiedEmbeddedPostgres.start`, migrations applied, connecting as a non-superuser,
non-BYPASSRLS app role and the privileged role exactly as the production pools do (see `LayoutStripDbSupport` /
`V122StripDeletedPanelLayoutItemsSpec`). Two real connections, explicit transactions, interleave driven by observed
lock waits (`pg_stat_activity.wait_event_type = 'Lock'`), never sleeps-as-proof. The production window is: T2's
`DELETE FROM dashboards WHERE id = D` holds D and its cascade needs P, while T1's `DELETE FROM panels WHERE id = P`
holds P and V122 needs D. A single DELETE takes P then D within one statement, so the test may model "T1 holds P" with
`SELECT ... FROM panels WHERE id = P FOR UPDATE` before T2 deletes D, then T1 issues the real `DELETE` — state this
modelling in the spec comment; the 40P01 must come from the real V122 trigger and the real FK cascade. Assert one side
gets SQLSTATE 40P01. Record the result in `probe-deadlock.md` (in the change dir) either way.
- **Not reproduced** after a genuine attempt at both interleavings: no production code change for item 2, the
  `dashboard-delete` spec delta is removed, evidence recorded, PR says so.
- **Reproduced:** every dashboard-deleting transaction first locks that dashboard's panel rows,
  `SELECT id FROM panels WHERE dashboard_id IN (...) ORDER BY id FOR UPDATE`, BEFORE any statement that can delete a
  panel or a dashboard. Order becomes panel rows -> dashboards, matching V122. Sites:
  (a) `DashboardRepository.delete` (`withSystemContext`, privileged/BYPASSRLS pool, one transaction): pre-lock, then
  the dashboard DELETE.
  (b) `WorkspaceTeardownRepository.planAndExecute` (~lines 150-160): the pre-lock is the FIRST write-phase statement,
  before `deletePipelines` — that cascade (outputs -> panels, V94) already fires V122, which locks each tagged dashboard,
  so a pre-lock placed just before `deleteDashboards` would be too late (skeptic-design-1 CR1). This transaction runs
  under the caller's RLS context; the teardown caller is the dashboards' owner, who can see all of the dashboard's
  panels under V36's panel policies (V36:146-152), so the `FOR UPDATE` covers every panel the cascade will delete.
  Teardown gets its own interleave test (teardown vs concurrent single-panel delete), red then green.
  A panel deleted concurrently is skipped by `FOR UPDATE` after its commit (READ COMMITTED recheck) — no error. A
  concurrent create (locks D, inserts P2) never waits on existing panel rows, so no new inversion; the cascade still
  removes P2. No migration needed; if SQL is required it is a NEW V124 (number re-checked before commit), never an
  edit to V122/V123.
- **Residual, scoped out (skeptic-design-1 CR2).** This makes the dashboard<->panel order single, NOT the panel<->panel
  order: other multi-panel deleters (`replaceContents`, the output/pipeline/step FK cascades, `batchUpdate`) take panel
  rows in scan or request order, not `ORDER BY id`. A dashboard delete racing one of them over two or more shared panels
  can still 40P01 — exactly as it could before this change (not a regression, and not reachable by item 2's
  single-panel race). Scoped out of HEL-1485; stated in the code comment, `probe-deadlock.md` and the PR body, and listed
  as a follow-up candidate.
- Retry-on-40P01 rejected as primary: it hides the inversion, adds a retry loop to a delete path, and the reorder is
  smaller. Neither option changes user-visible behaviour (both requests succeed), so this is not a product call.

**D3 — Auto-layout uses the same filter.** In `AutoLayoutService`, after `findAllByDashboardId`, read
`dashboardRepo.panelIdsInternal(dashboardId)` and pack against `LayoutPolicy.onlyPanels(existing.layout, panelIds)`
— the filtered layout is BOTH the base of `kept` (~line 102) and the `existing` passed to `LayoutPolicy(...)`
(~line 109), so `kept`, the offset, and every untargeted breakpoint written back are ghost-free. Unknown-panel 400 is unchanged
(still from the requested ids vs `findAllByDashboardId`). Red-first tests: a stored ghost in a targeted breakpoint is
not kept and does not push the packed offset down; a stored ghost in an UNtargeted breakpoint is not written back.
The remaining window (panel deleted between this unlocked read and the write) is the HEL-1457 class shared with PATCH;
recorded in a code comment and the PR, not fixed here.

**Test labelling (C1).** The deadlock specs prove the lock cycle exists, not how often it occurs; their names/comments
say so.

**D4 — Undo check refactor.** `checkDashboard` filters `liveDashboard.layout` directly and converts only the journaled
response layout. Same comparison semantics; existing D7 undo tests are the guard (no new red test: refactor).

## Risks / Trade-offs

- RLS is bypassed for superusers; D2's repro must run as the non-superuser roles or it proves nothing (MISTAKES.md).
- Deadlock tests can be timing-flaky; the interleave must be driven by observed lock waits, with a bounded timeout,
  and `deadlock_timeout` may be lowered for the test session only.
- HEL-1475 may edit patch-set undo concurrently: D4 is a few lines; re-sync before PR.
- Preview now does one extra read per dashboard-update edit (cheap, indexed by `dashboard_id`).

## Planner Notes

- Self-approved: lock reorder over retry (D2), not user-visible; shared filter helper (D1); no migration expected.
- Premise check: all four claims confirmed on main bcb0e8919; ticket line 214 is ~212 now.
- Driver brief: `[hel1468-guard]` must appear in sbt runs; new DB specs use `VerifiedEmbeddedPostgres.start`.
