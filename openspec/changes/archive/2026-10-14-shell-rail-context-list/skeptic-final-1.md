## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `31b11d02a23485937f7c4a013a19121697931bab`. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`. The review base was resolved live: `resolve-review-base.sh` returned `015a491932bacc9a0e7fdffca7b59d76af2d4b61` (HEL-1562), exit 0. Diff: 141 files, +7646/-1705.

I checked the running app on ports 7006/9913 (`start-servers.sh`, then `assert-phase.sh servers` = PASS), signed in as `matt@helio.dev` (owner tier, accent #eab308). I looked at it in both themes at 1280, 820, 768 and 375px. Afterwards I stopped the servers with `stop-servers.sh` (`STOPPED ports=7006,9913`) and closed the browser.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/openspec/changes/shell-rail-context-list/evidence/skeptic-final/` holds `folders-reload-1280-dark.png`, `dash-1280-dark.png`, `dash-1280-theme1.png` (light), `avatar-menu-1280-light.png`, `sources-1280-dark.png` and `pipelines-375-light.png`. Every other screenshot named below is in the worktree's `evidence/skeptic-final/`.

### What I verified (with evidence)

**AC1: rail, one click while the list is collapsed — MET**
- The live DOM on `/connectors` (no list) has these rail entries in this order: `Helio home:/home`, `Home:/home`, `Dashboards:/home`, `Data Sources:/sources`, `Data Pipelines:/pipelines`, `Connectors:/connectors`, `Assistant:/chat`, `Settings:/settings`, `User menu`. Only Connectors carries `aria-current`.
- With the Sources list collapsed (`sources-collapsed-1280-dark.png`), clicking the rail's Data Pipelines item navigated to `/pipelines`.
- The rail is 56px wide and paints `--app-bg`. The list paints `--app-surface-soft`. Measured: dark = rgb(15,14,13) and rgb(22,21,20); light = #f4f2ed and #efece6.

**AC2: resize, clamp, persistence, no flash, one PATCH — MET**
- **Pointer drag.** I dispatched 30 pointermove frames on the separator. The width moved 258 → 308 → 400 and clamped at 400. XHR spy over the whole drag: exactly `["PATCH /api/users/me/preferences"]`.
- **Drag past the minimum.** It clamped at 200.
- **Real keyboard.** After focusing the separator: ArrowRight, ArrowRight, Shift+ArrowRight went 248 → 344 (16 + 16 + 64), and `aria-valuenow` followed. Home and End jump to 200 and 400.
- **Enter collapses and expands.** Enter collapsed the list and focus landed on "Expand list" (`:focus-visible` true). Enter again expanded it and focus landed on "Collapse list". The server held `contextListWidth: 344`, `contextListCollapsed: false`.
- **No flash.** Sampling every 50ms across a fresh reload: no `.app-shell` at 24ms, then at 742ms `--context-list-width: 264px` (the saved value) on the very first shell frame. The default 248 never appears.
- **Validation.** `contextListWidth: 401` → 400. `{foo:1}` → 400.
- **Accent survives a shell write.** After shell PATCHes, `/me` still returns `accentColor` and `zoomLevels` alongside the shell keys. `upsertGlobalPrefs` is now a jsonb `||` merge.

**AC3: folders end to end — PARTIALLY MET (see CR1)**
- Create, rename (inline, Enter), "Move to…" from the row actions, and reload persistence all work live. "SkepticDaily" was created, a dashboard was moved in, the folder was renamed to "SkepticRenamed", and it was still there after reload with counts 1 / Unfiled 5 (`folders-reload-1280-dark.png`).
- **Collapse is broken for the folder that holds the active dashboard.** Details under CR1.
- **Backend.**
  - `DashboardFolderRepository` runs every statement in `withUserContext` and also filters on `owner_id`.
  - V134 makes both tables `ENABLE` + `FORCE ROW LEVEL SECURITY`, with a USING + WITH CHECK owner policy and a composite FK `(folder_id, owner_id)`.
  - `DashboardFolderRlsSpec` (read in full) creates `NOSUPERUSER NOBYPASSRLS` roles and asserts `rolsuper = false` / `rolbypassrls = false`. It runs both as a non-owner and as the TABLE OWNER, so FORCE is exercised. It covers cross-user SELECT, INSERT, UPDATE and DELETE, the WITH CHECK owner change, access with no context, and the composite FK. That meets MISTAKES.md's RLS proof requirement.
  - Schemas exist for every folder body. There is no OpenAPI document in the tree; design.md records this and the design gate accepted it.
- `move` calls `accessChecker.requireAccess` before filing.

**AC4: Pipelines list no longer duplicates the table — MET**
- `/pipelines` shows Recent, Scheduled and "View all pipelines", not the table (`pipelines-1280-dark.png`).
- I put a temporary yearly cron on "Profit (migrated)". After the scheduler tick, `/api/pipeline-schedules` returned `nextRunAt 2027-01-01T03:00Z` in both `items` and `sources`, and `/sources` showed "Profit — next Dec 31, 07:00 PM · Prof…" under Scheduled (`sources-1280-dark.png`).
- Two queries, `DISTINCT ON (ds.id) ... ORDER BY next_run_at ASC NULLS LAST`, give the soonest run. I deleted the schedule afterwards (204).

**AC5 / owner phone ruling — MET**
- At 768px and 375px there is no rail and no list. The BottomNav order is Home, Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, Usage, each tab 48px. `scrollWidth == clientWidth` (349).
- Exactly one visible `aria-current`: Data Pipelines on `/pipelines`, and Dashboards after tapping Home (`/home`).
- There is one avatar trigger, and the logo href is `/home` (`pipelines-375-light.png`, `sources-375-dark.png`).
- 768 being a phone layout follows design D1, which the design gate accepted (no 769 query).

**Usage in the avatar menu — MET**
- The rail avatar menu shows Settings, Usage, Getting started and Sign out (`avatar-menu-1280-light.png`). The rail has no Usage item.

**Delete from the detail pages — MET**
- `/pipelines/:id` header actions: Edit source, Set schedule, Run history, Share, **Delete pipeline**.
- Source delete is covered by `SourceDetailPanel.test.tsx` (in my targeted jest run) and by evaluation-2's live check. I did not delete live dev data.

**Design**
- **DESIGN.md.**
  - §9: rail order, surfaces, the 768 boundary, the separator contract, and per-section content all match the code.
  - §10: provenance relabelled as owner rulings.
  - §12: Home tab, plus the 320px overflow handed to HEL-1583.
- **Accent discipline.**
  - Only the active rail item and the active list row carry the accent wash in both themes. Rail glyphs use `--app-accent-text`.
  - `grep` of the added CSS lines finds no hex or rgb literal, no `font-family` other than `var(--font-*)`, and no ms literal.
  - `--app-surface` measured `#1a1816` in dark.
  - `check:tokens` OK. `check:schemas` exit 0 (131 checked).
- **Compared with B2.** The structure matches: rail on `--app-bg`, a darker list, folder groups with mono counts, the accent-washed active row, the avatar at the foot.
- **Small differences (not blocking).**
  - The create/new icons sit on a second row rather than in the header.
  - The folder kebab is always visible while row kebabs appear only on hover.
- **Guards and scripts.**
  - `splitTopLevelCommas` correctly fixes `Map[String, Double]` splitting.
  - Two `SKIP` entries are justified: both bodies are read as raw JSON, and each one's schema matches its route's validation (`additionalProperties: false`, 200..400, `folderId` required and nullable).
  - The `--context-list-width` allowlist entry is accurate.
  - The CSS-count bumps are 133 → 135: +3 new files, -1 removed.
- **E2E geometry edits.** They move the viewport by +64px (the extra chrome: 56 + 248 + 48 = 352 versus the old 240 + 48 = 288) so each spec measures the same grid container width as before. The specs' intent is preserved, not weakened. The state-surface guard now probes `.context-list` per route and keeps the rail in the chrome view. Dropping the "seeded name visible in the sidebar" checks for sources and pipelines follows from AC4.

**Gates**
- Targeted jest (`nice -n 19`, `--maxWorkers=3`) over shell/, AppShell.rail, DashboardList*, dashboardFoldersSlice, authSlice, BottomNav, UserMenu, SourceDetailPanel, PipelineDetailPage and App.test: **32 suites, 485 tests passed**.
- I relied on the evaluator's pasted full-suite results in evaluation-2 (jest 7215/7215, sbt 8106/0 failed, Playwright 288 passed). They were not re-run.

**Instability noted and ruled out**
- Two screenshots (820 and 768) caught a full-screen spinner right after navigation.
- I re-measured with 50ms DOM sampling across fresh reloads at 820 and 1280. The shell mounts once and never unmounts; there is no remount.
- This was screenshot timing against page load, not a defect.

### Verdict: REFUTE

### Change Requests

1. **A folder's disclosure toggle is dead whenever the folder holds the active dashboard.**
   - **Where.** `frontend/src/features/dashboards/ui/DashboardList.tsx:599-601` computes `expanded = !folder.collapsed || dashboards.some(d => d.id === selectedDashboardId)`. `DashboardFolderGroup.tsx:106-110` then dispatches `setDashboardFolderCollapsed({collapsed: expanded})`.
   - **What happens.** Once the saved state is `collapsed: true`, the auto-expand pins the folder open, so every click PATCHes `collapsed: true` again and nothing changes.
   - **Reproduced live, twice.** I clicked "SkepticRenamed" (holding the active "HEL-1189 Skeptic Verify") two times. `aria-expanded` stayed `"true"` before and after, two `PATCH /api/dashboard-folders/aeff2cfd…` went out, and the server stored `collapsed: true`. The chevron still points down after reload (`folders-reload-1280-dark.png`).
   - **Why it matters.**
     - On a dashboard route there is always a selected dashboard, so the folder the user is working in can never be collapsed. That breaks AC3's "collapse" for the most common case.
     - It also breaks the spec scenario "Collapse persists across reloads" whenever "Work" holds the active dashboard.
     - It leaves a focusable control with `aria-expanded="true"` that ignores activation.
     - The folder then snaps shut later, when the user switches to another dashboard, because of a saved state they never saw take effect.
   - **Fix.** Make the active-dashboard auto-expand a one-shot reveal rather than a permanent override. For example: when the selected dashboard changes into a collapsed folder, expand it (locally, or by persisting `collapsed: false`); after that, honour the toggle. The toggle must always flip what is rendered, and the value it sends must be the inverse of what is rendered.
   - **Tests.** Replace the test at `DashboardList.folders.test.tsx:97` ("keeps the active dashboard's folder open even when saved as collapsed"). The new test must assert that clicking the toggle on the active dashboard's folder collapses it, flips `aria-expanded` to `false`, and PATCHes `collapsed: true`. Add a second test asserting that navigating into a collapsed folder's dashboard reveals it.

2. **Fix the false comments the change introduced.** These are comments asserting things that are no longer true (the HEL-1467 class of defect):
   - `frontend/src/features/dashboards/ui/DashboardList.css:103-110` says the context list has an `--app-surface-soft` backdrop and, in the same comment, that "soft-on-`.context-list` (`rgb(26,24,22)`) is 1.030 in dark". `rgb(26,24,22)` is `--app-surface`. The list's measured dark backdrop is rgb(22,21,20). Soft-on-soft would be 1.0, not 1.030. Re-state the rationale against the real backdrop. The same stale `--app-surface` / `rgb(26,24,22)` backdrop claims appear in the other `.context-list`-scoped dark hover comments in this file.
   - `frontend/src/app/shell/AppRail.tsx:56` says "Home aliases `/` until HEL-1578". It aliases `/home`.
   - `frontend/src/shared/chrome/BottomNav.tsx:23-24` says "while it aliases `/`". Same fix.

### Non-blocking notes
- The folder-actions kebab is always visible while row kebabs appear only on hover or focus. Consider the same reveal pattern for consistency with the rows (B2 shows neither at rest).
- The Scheduled row's next-run label omits the year ("next Dec 31, 07:00 PM" for a run in 2027). Consider adding the year when the run is not this year.
- On `/pipelines` and `/sources` themselves, "View all pipelines/sources" links to the page already on screen. This is harmless, but it could be hidden on the index route.
- The `as unknown as` casts in `pipelineScheduleListService.ts` and the missing selftest for `splitTopLevelCommas` (both carried over from evaluation-2) remain minor.
- **Dev-data hygiene.** I restored everything I touched: deleted the folder, removed the schedule (204), and reset width to 248 / collapsed false. My only persistent residue is the screenshots.
