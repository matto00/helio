## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `dade51b70bf8683d253f7ef1b864d36f0a879417`, five commits on base `cd64409ad828d9024074f907a7ea32800ab71ff3`. The base was resolved live with `resolve-review-base.sh`. 131 files changed.

### Gates (run fresh by the evaluator in this worktree)

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eslint . --max-warnings=0` |
| `npm run format:check` | exit 0 | "All matched files use Prettier code style!" |
| `npm run typecheck` | exit 0 | |
| `npm test` (jest, 3 workers, nice 19) | exit 0 | helio-mcp: 51 suites / 469 tests. Frontend: 628 suites / 7464 tests, 19 snapshots |
| `npm --prefix frontend run build` | exit 0 | |
| `cd backend && sbt testFull` (run once) | exit 0 | 8145 tests succeeded, 0 failed, 4 canceled (pre-existing), 620 suites. The sbt output shows this worktree's `backend/` path. `DashboardChangesRoutesSpec` (10 cases), `UserPreferencesRoutesSpec` (the 6 new `dashboardTabs` cases) and `AuthServiceSpec` all executed |
| `check:schemas`, `check:tokens`, `check:openspec`, `check:scala-quality` | exit 0 | |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, nice 19, servers from `start-servers.sh` on 7007/9914) | 17 passed (1.1m) | Run from this worktree's root. Teardown: "deleted 17 recorded throwaway user(s)" |

Independent red-first mutations. Each was run in a throwaway detached worktree at HEAD, which was removed afterwards (`git worktree list` shows no straggler):

- Remove only the unmount-flush effect in `usePanelUpdatesFlush.ts`. `PanelGrid.unmountFlush.test.tsx` fails 2 of 5: "flushes staged panel edits immediately when the grid unmounts" and "flushes on a dashboard switch (keyed remount)".
- Revert only `clearSentPendingPanelUpdates` back to `clearPendingPanelUpdates()`. The same file fails 2 of 5, the two task 4.5(5) cases.
- Revert `usePanelRunRefresh.ts` to base. `usePanelRunRefresh.test.ts` fails 1 of 8, the new metadata re-read case.

So each C7 test and the run-refresh test fails on the pre-fix code. The executor's `evidence-red-first.md` claim is confirmed by mutation, not just by its transcript.

### Phase 1: Spec Review — PASS

Every acceptance criterion and owner ruling (1-4) is addressed. Tasks 1.1-8.4 are all ticked and match the code.

AC to evidence:

- **AC1 (mouse, keyboard, tablist).** e2e test 1 covers Ctrl-click and middle-click background tabs, activation, Alt+Shift+Arrow reorder, drag reorder, the order surviving a reload, Delete close with the neighbour rule, pointer close, and the empty state persisting. The RTL tests in `DashboardTabBar.test.tsx` cover roles and keys. Live check: the tablist owns only `presentation` wrappers, there is one `tabIndex=0` roving stop, `aria-describedby` reads "Press Delete to close", and the close control is `aria-hidden`.
- **AC2 (server persistence).**
  - Schemas: `schemas/auth/*preferences*.schema.json` and `schemas/dashboards/dashboard-change*.schema.json`, with the drift check green.
  - Backend: `UserPreferencesRoutesSpec` and `AuthServiceSpec` carry the key on login/me.
  - e2e: a reload and a second browser context restore the order and the active tab.
- **AC3 (warm switch with no refetch; expired tab refetches).** The e2e network-log tests assert zero `GET /api/dashboards/*/panels` and `/api/outputs/*/rows` requests on a warm switch, on a reload within the TTL, and on a lazily restored tab. A 16-minute `page.clock` fast-forward refetches the panel list. The absence assertions are shown to be failable: `evidence-red-first.md` records this suite going red on the pre-fix `usePanelRunRefresh`.
- **AC4 (TTL and timings).** `measurements.md` records 15 min / 8 tabs, cold median 615 ms vs warm 297 ms, and the method. The PR must carry them.
- **AC5 (⌘K and the ask action).** Verified live at 375px: typing "revenue" lists the search results, then an "Ask" section last containing `Ask the assistant: "revenue"`. e2e test 17 asserts exactly one converse request.

**C5 (NOBYPASSRLS).** Satisfied.

- `DashboardChangesRoutesSpec` runs on `TwoUserRlsApiFixture` and asserts `rolbypassrls = false` for `helio_app_test`.
- Its "dashboard-only grantee sees no data time, pipeline grantee does" case and its "another user's private dashboard omitted" case would both fail on a BYPASSRLS pool, so the RLS proof is failable.
- The preferences path builds `UserPreferenceRepository(appDb)` on the same NOBYPASSRLS app pool (`TwoUserRlsApiFixture.scala:117`). Isolation is proven byte-identical in "leave another user's stored preferences byte-identical".
- No new table and no Flyway migration.

**C7.** Proven red-first by mutation (above). The behaviour change still has to be called out in the PR body.

**Rendered-file rule.** Satisfied:

- No `scripts/concertino/**`, `.concertino/laws/**` or `.claude/**` path appears in the diff.
- Both directories are gitignored (`!!`).
- `diff -rq` of both against the main checkout's render is empty.

**Opt-in measurement spec residue.** None. It sets `owner` tier via the pre-existing guarded `setUserTierForTest`, which updates exactly one UUID and refuses `matt@helio.dev`. The user is recorded by `registerUser`, so the HEL-1301 global teardown deletes it. Dev DB checked after my own e2e run:

- `users where email like 'hel1575%'` = 0;
- dashboards, sources and pipelines named `%HEL-1575%` = 0;
- `pg_roles like 'hel1575%'` = 0 (the throwaway EXPLAIN role was dropped);
- the owner-tier users are only the 3 pre-existing accounts.

Issues: none blocking. One planning-artifact accuracy defect is listed under Change Request 4.

### Phase 2: Code Review — FAIL

**`usePanelRunRefresh` -> `fetchOutputMeta`: correct, with a stated cost.**

- `pipelineRunFanout.ts:244-245` and `:322-323` call `invalidatePipeline` before notifying listeners. The callback's `fetchOutputMeta` therefore runs under the new generation, records its `sequenceAtStart` after the bump, and caches the result. The next remount then gets `getOutputMetaCached(outputId)` and with it the run baseline that `isReusable` needs.
- Concurrent callers for the same Output share one in-flight promise (`outputMetaCache.ts:39-41`).
- Cost: one extra `GET /api/outputs/:id` per distinct mounted Output per succeeded run (and per reconciled run on a remount), on top of the existing rows refresh. In exchange, the metadata and rows reads that a later tab return would have made are avoided. A re-read is more honest than restamping the cached generation, because a run can change an Output's schema.

Change requests 1-3 follow. Other findings:

- **DRY / modularity / readability: OK.** The warm cache is split into small pure modules: validity, config, store, capture, restore and sweep.
- **Security: OK.**
  - The `dashboard-changes` ids go through parameterised SQL arrays.
  - Inaccessible ids are omitted, with no 403/404 oracle.
  - The browser copy is allow-listed (`warmStore.ts:62`, tested in `boundedWarmStore.test.ts:37`), per-user, at most 1 MiB, cleared on `clearAuth`, and epoch-guarded.
  - The keepalive PATCH carries the CSRF header.
- **Error handling: OK.** Persistence failures keep local state. Restore failures and timeouts fall back to cold loads.
- **Tests: meaningful.** See the mutation results above.
- **Dead code:** none found.
- **Behaviour-preserving:**
  - The panel delete now bumps `dashboards.last_updated`. This is intended (D6) and is red/green-tested in "advance the dashboard's last_updated" (red pre-fix: it would stay at T0).
  - The batch save clearing only the sent keys is an intended C7 change.

Issues: change requests 1-3 below.

### Phase 3: UI Review — FAIL

Live checks ran against the running app: `start-servers.sh` and `assert-phase.sh servers` both PASS on 7007/9914, signed in as `matt@helio.dev`. The account's accent is the **Yellow** preset (#eab308).

- **Happy path:** tabs render and switch, the changed dot appears after a content change plus a signal refresh, and the accessible name gains ", changed since you last viewed".
- **Breakpoints:**
  - 1280: the strip, "+" and the full box render.
  - 820: the strip overflows, and the box collapses to the icon plus `Ctrl K`.
  - 768 and 375: no tablist and no tabpanel (phone shell), with no horizontal scroll.
  - Checked in both themes.
- **Console:** only my own pre-login 401s, my own 403s from a mis-headed probe fetch, and a pre-existing ECharts resize warning. No error comes from the tab, palette or switch flows.

Evidence screenshots, saved directly to the durable evidence directory:

- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/dark-1280-yellow-accent-dot.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/light-1280-yellow-accent-dot.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/light-820-tabs.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/light-768.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/dark-375-palette-ask.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-1/dark-1280-tab-focus.png`

Light theme was applied by setting `data-theme` live, which was not persisted. The dark panel cards in the light shots are that dashboard's own stored appearance and predate this change.

**`--app-warning` dot vs DESIGN.md §0/§9.**

- Mechanically compliant: it is an intent token, not the accent, and it has no literal.
- Contrast is about 5.4:1 in light (#85551a on #efece6) and much higher in dark.
- §9, as amended by this diff, names the token explicitly.
- However, with the Yellow preset in dark the dot (#f5b944) is visually the same hue as the accent active-tab bar and the context list's accent marker (#eab308). See `dark-1280-yellow-accent-dot.png`. Whether that breaks §0's [judgment] accent discipline is the skeptic's call. The written claim that it "differs from the accent in every preset" is objectively wrong (CR 4).

Issues: CR 1 and CR 2 (focus ring clipping and the close-control size and touch floor) are UI defects observed live.

### Overall: FAIL

### Change Requests

1. **The tab focus ring is clipped (DESIGN.md §8 [mechanical]: "use `-2px` only where the ring would clip").**
   - Problem: the tab button fills the strip's full height. Measured live: strip y 8-48, button y 8-48, `outline-offset: 2px`. Meanwhile `.dashboard-tab-bar__strip` has `overflow-y: hidden` (`DashboardTabBar.css:30`) and `overflow-x: auto`. The global 2px ring's top and bottom are therefore cut off: only two vertical lines show (`dark-1280-tab-focus.png`). The leftmost tab's left edge is clipped by the scroller too.
   - Fix: in `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css`, add `.dashboard-tab__button:focus-visible { outline-offset: -2px; }`.
   - Verify: a screenshot of a keyboard-focused tab shows a closed ring on all four sides.
2. **The tab close control breaks the §3 control metrics and the 44px touch floor (both [mechanical]).**
   - Problem 1: `.dashboard-tab__close` is `width: 20px; height: 20px` (`DashboardTabBar.css:124-129`, live 20x20). DESIGN.md allows control heights of 28/32/40, or 24 only for "inline mini icon-buttons inside dense rows", and states "No other control heights".
   - Problem 2: under `(pointer: coarse)` (`:161-169`) it becomes 28px with no hit expander. A sighted tablet user, whose strip is above 768px, gets a 28px target. The touch floor requires a sized `::after` expander on every painted button.
   - The stated reason, "an expander would overlap the neighbouring tab" (`ui-decisions.md:9`), does not hold. Under coarse pointers the tab is 44px tall and the close has `margin-right: var(--space-2)` (8px). A 44x44 expander centred on the 28px box extends 8px per side: it ends exactly at its own tab's right edge, and its left extension falls on its own tab button, never on the neighbour.
   - Fix: make the base size 24px. Under `(pointer: coarse)`, add `position: relative` plus the canonical `::after` 44x44 expander (`shared/ui/tapTarget.css`), and assert it with `expectTapExpander()` in `DashboardTabBar.test.tsx`.
   - Also update `ui-decisions.md:9`. The keyboard and AT limit (aria-hidden close, Delete key) is unaffected.
3. **Undocumented untyped escape hatches (CONTRIBUTING.md Frontend: "Avoid `any` - use proper types"; checklist: no escape hatch without documented justification).**
   - `frontend/src/main.tsx:33`: `startTabsBrowserTriggers(store as never)`. Type `StoreLike` in `tabsBrowserTriggers.ts` as `Pick<AppStore, "dispatch" | "getState">` (or `AppDispatch` / `() => RootState`) and drop the cast.
   - `frontend/src/features/dashboards/tabs/hydrateTabs.ts:84,162` (`dispatch: (a: never) => unknown`) and `:97` (`dispatch: dispatch as never`). Type these parameters as `AppDispatch`, the same type `applyWarmEntry` expects via `Dispatch<UnknownAction>`, and remove the cast.
   - `frontend/src/features/dashboards/tabs/warm/warmListeners.ts:169` (`source.dashboardIds(action as never)`, with the `dashboardIds: (action: never) => string[]` table type). Either make `OwnWriteSource` generic over its matched action (`matches: (a: Action) => a is A`, with `dashboardIds: (a: A) => string[]` built by a small `ownWriteSource(thunk.fulfilled, fn)` helper), or add a one-line justification comment. The comment should explain that the heterogeneous table is narrowed by `matches` before `dashboardIds` is called, and that `warmListeners.test.ts`'s own-write table exercises each shape.
4. **A planning-artifact claim is contradicted by the running app** (Phase 1, "planning artifacts reflect the final implemented behavior").
   - Problem: `ui-decisions.md:3` says `--app-warning` "differs from the accent in every preset and both themes". With the Yellow preset (#eab308) in dark, `--app-warning` is #f5b944, the same amber hue as the accent (evidence: `dark-1280-yellow-accent-dot.png`, where the dotted tab sits beside the accent active-tab bar and the accent list marker).
   - Fix: correct the sentence to state the Yellow-preset collision, and record it as an open [judgment] item for the skeptic or owner. Alternatively, if the skeptic rules it a cohesion defect, choose a treatment that stays distinguishable from every accent preset (for example `--app-text-muted` or a hollow/ring dot).
   - The token choice itself is not failed here; only the false claim is.

### Non-blocking Suggestions

- **APG tab stop.** `DashboardTabBar.tsx` keeps the roving stop on the last *focused* tab (`focusedId`) after focus leaves the tablist. APG says re-entry lands on the active tab. Consider clearing `focusedId` on the strip's `onBlur` when focus leaves the tablist.
- **e2e strength.** "an expired tab (16 minutes) refetches its panels" asserts only the panel-list request; the spec scenario also says rows. "a run while the tab is away..." asserts that a rows request happened, not that new data is shown. The seed data is static, so a run returns identical rows. Consider asserting a rows request after expiry, and seeding a source whose run changes a value.
- **Backend id typing.** `DashboardChangesService.changes(rawIds: String, ...)` and `DashboardChangesRepository.changes(userId, ids: Vector[String])` take raw strings. CONTRIBUTING's value-class rule targets path-extracted ids, and these are query-param ids. Wrapping them in `DashboardId` at the service boundary would still match the convention.
- **File-size budget.** Per CONTRIBUTING (~400 lines: "propose a split in the PR description"), the PR body should propose splits for:
  - `App.tsx` (412 -> 444)
  - `panelsSlice.ts` (459 -> 506)
  - `PanelList.tsx` (500 -> 504)
  - `PanelRepository.scala` (423 -> 435)
  - `DashboardList.tsx` (640 -> 653)
  - `panelThunks.ts` (401 -> 405)
- **PR body.** It must carry:
  - the C7 behaviour change (panel edits flushed on leave; a batch save clears only the keys it sent);
  - the TTL and the warm/cold numbers;
  - the panel-delete reordering of the dashboards list;
  - the tablet touch-AT close limit;
  - the extra `GET /api/outputs/:id` per succeeded run per visible Output, from `usePanelRunRefresh`.
- **Evidence transcript.** `e2e-run.txt` records "0831ee486 plus the uncommitted phase-C changes". This evaluation's 17/17 run at the committed HEAD `dade51b70` supersedes it.
- **Servers.** The dev servers on 7007/9914 were left running for the next gate. Stop them with `scripts/concertino/stop-servers.sh "$WORKTREE_PATH" 7007 9914` when done.
