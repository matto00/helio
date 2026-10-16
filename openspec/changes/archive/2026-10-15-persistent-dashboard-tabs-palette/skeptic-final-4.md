## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed head: `c999d3ccfa9807956eab49b3f41b90176ecc1cd0` (worktree
`/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/persistent-dashboard-tabs-palette/HEL-1575`.
- **Live review base:** `resolve-review-base.sh <wt> main origin` -> `38de7610a` (HEL-1576). `git rev-parse origin/main` = `2a9f9e467`
  (HEL-1572 "Appearance settings: type style, density and motion preferences per user", #1046), confirmed against the remote with
  `git ls-remote origin main` = `2a9f9e4677f7019f5f6a36c4f72e5146cf25df85`, checked twice.
- **The brief's premise "origin/main is an ancestor" is false at review time.** `git merge-base --is-ancestor origin/main HEAD` -> rc=1;
  `git merge-base HEAD origin/main` = `38de7610a`. HEL-1572 merged after the head was pushed.
- **The branch no longer merges.** `git merge-tree --write-tree --name-only HEAD origin/main` reports CONTENT conflicts in 14 files, among them
  `UserPreferencesRoutes.scala`, `UserPreferenceRepository.scala`, `AuthProtocol.scala`, `UserResponseAssembler.scala`, `ApiRoutes.scala`,
  `AuthServiceSpec.scala`, `frontend/src/features/auth/types/user.ts`, `frontend/src/main.tsx`, both token-guard CSS-count pins, `DESIGN.md`,
  `openspec/specs/user-ui-preferences/spec.md`, and both `schemas/auth/*preferences*.schema.json`. GitHub agrees on its own:
  `gh pr view 1032` -> `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY` (headRefOid `c999d3ccf`, all checks SUCCESS on the old base).
  So the failure shows up in two independent measurements.
- **The conflict is semantic, not textual.** Both lanes rewrote the same `PATCH /api/users/me/preferences` contract in incompatible shapes.
  This branch threads a third tuple element `Option[DashboardTabsPref]` through `validate` and into `patchShellPrefs(userId, width, collapsed, tabs)`.
  HEL-1572 replaced `patchShellPrefs` with `patchPrefs(userId, PreferencesPatch)`, added `typeStyle`/`density`/`motion` (and `motion: null` clears
  via `- 'motion'` in `mergePrefs`), and widened `UserPreferences(...)` to 7 fields. This branch widens the same constructor to 5 fields with a
  different fifth field. Resolving this means changing the API contract, the JSON Schemas, the openspec spec and the backend tests. The merged
  tree has never been compiled or tested, so no green CI result on `c999d3ccf` carries over to it.
- **Things I checked on the current head that do hold** (so the next round can focus on the merge):
  - Locator/guard edits from the fix cycles (`git diff 38de7610a...HEAD` on `e2e/hel503`, `hel516`, `hel588`, `hel1028`, `hel1457`, the token
    guards and `networkGuard.ts`). None weakens an assertion. hel503 now also pins the total at 6, which is stricter. hel1457 adds a
    `Done`-visible assertion. The allowlist only lost entries. The CSS pins went 142 -> 144 and the guards still walk every file.
  - Shared predicates. `dashboardChrome.ts` has one private `isRailDashboardView` behind `usesDashboardMetaRow` and `usesDashboardTabBar`.
    `hidesBreadcrumbItemName` keeps HEL-1579's pipeline-detail clause unchanged and adds only the tab-bar clause. The phone shell still returns
    false first. HEL-1576/1579 behaviour is preserved by construction, and `dashboardChrome.test.ts` checks the two predicates are equal across
    rail and phone paths.
  - D7 leave and refresh logic (`tabsBrowserTriggers.ts`). A leave is latched once per hidden/pagehide pair. The stamp and capture happen only on
    the dashboard view. The server stamp is refreshed only when it is 5 minutes old or older. The capture always uses `viewedAt: serverNowMs()`,
    which matches C1. The visible refresh is gated at 30 s, and the interval refresh runs only on the dashboard view.
  - Logout. `authSlice.logout` awaits `awaitWarmClear()` before `clearAuth`. The tabs PATCH response is not written back into auth state
    (`patchDashboardTabsRequest` returns void).
- **Not done this round, deliberately:** the visual and accent review at 1280/820/768/375 in both themes, and fresh full jest/e2e/sbt runs. They would
  measure a tree that cannot ship. HEL-1572 changes density, the grid gutter, the type style, `DesktopPanelGridSkeleton`, `main.tsx` boot and
  `DESIGN.md`, all of which bear directly on the tab strip, the meta row under it and the skeleton-aware e2e waits. The visual verdict has to be
  made on the merged head.

### Verdict: REFUTE

Category: mechanical. The reviewed head cannot be merged (CONFLICTING against origin/main), and the conflict sits in this ticket's own
server-persistence contract (AC2).

### Change Requests

1. **Merge `origin/main` (`2a9f9e467`, HEL-1572) into the branch and resolve the preferences contract into one shape.**
   - `UserPreferencesRoutes.validate` accepts `dashboardTabs` alongside `typeStyle`/`density`/`motion`.
   - Use HEL-1572's `PreferencesPatch` with a `dashboardTabs: Option[DashboardTabsPref]` field added. Do not keep a parallel `patchShellPrefs`.
   - `UserPreferencesData`, the `UserPreferences` response and `UserResponseAssembler` carry all of accent, zoom, width, collapsed, typeStyle,
     density, motion and dashboardTabs.
   - `mergePrefs` keeps the `motion`-clear branch, and `dashboardTabs` still replaces the stored tab set as a whole.
   - `schemas/auth/user-preferences.schema.json` and `update-user-preferences-request.schema.json`, plus `openspec/specs/user-ui-preferences/spec.md`
     (live and the archived delta), must state the union.
2. **Add backend tests on the merged route (`UserPreferencesRoutesSpec`) for cross-key preservation in both directions.** A `dashboardTabs`
   PATCH leaves stored `typeStyle`/`density`/`motion` untouched. An appearance PATCH, including `motion: null`, leaves stored `dashboardTabs`
   untouched. A body mixing both kinds of key applies both. Run `sbt testFull` under the sbtfull lock and record the count.
3. **Resolve `frontend/src/main.tsx` so `startTabsBrowserTriggers(store)` and HEL-1572's appearance wiring both survive.** Resolve
   `auth/types/user.ts` the same way, keeping `dashboardTabs` plus the appearance fields. Then check the client seam:
   `updateUserPreferences.fulfilled` merges the server response into `currentUser.preferences`, so an accent or appearance write returns a
   server `dashboardTabs`. Confirm with a test that this cannot revert a newer in-memory tab set or re-trigger hydration.
4. **Recount the CSS-file pins with `find frontend/src -name '*.css' | wc -l` on the merged tree** (HEL-1572 adds at least `AppearanceSection.css`
   and `SegmentedRadioGroup.css`). Update both guards to the true count and do not loosen either. Resolve `DESIGN.md` so HEL-1572's density and
   gutter text and this branch's tab-bar section both stand.
5. **Re-run every gate on the merged head and get CI green on it:** lint, typecheck, format:check, build, full jest, full e2e under the e2e lock
   with workers 2, and `sbt testFull`. Pay particular attention to `hel1572-appearance-preferences.spec.ts` (it reads `/api/auth/me` preferences),
   `hel1574-shell-rail` (it counts preference writes) and the hel1575 suite under Compact density. Then return for a fresh final gate, which will
   do the visual and accent review in both themes at 1280/820/768/375, including Compact density and each type style on the tab strip and the
   meta row.

### Non-blocking notes

- HEL-1572 adds a per-user `motion` preference (full/subtle/off). The ticket's tab open/close animation is still owner-ruled static until HEL-1573.
  Make sure nothing in the merge starts animating tabs without honouring that preference. This is a note, not a request.
- The evaluator's `evaluation-8.md` is uncommitted in the archived change dir (`git status`: `??`). Commit it with the merge so the evidence
  chain is tracked.
