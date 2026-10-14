## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `1f1c32aeafc7979e529acddd63524ac5b230314f`.

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`.
- **Review base:** resolved live with `resolve-review-base.sh` (exit 0) to `015a491932bacc9a0e7fdffca7b59d76af2d4b61`. The branch diff is 146 files, +7956/-1716.
- **Change since round 1** (`31b11d02a..1f1c32aea`): 8 code files plus documents: `DashboardList.tsx`, `DashboardFolderGroup.tsx`, `DashboardList.folders.test.tsx`, `DashboardList.css`, `AppRail.tsx`, `AppRail.css`, `BottomNav.tsx` and `e2e/hel1574-shell-rail.spec.ts`. Everything else is byte-identical to what round 1 verified. The areas round 1 found holding (AC1, AC2, AC4, AC5, Usage in the avatar menu, RLS proof, schemas, tokens) are therefore unchanged in code, and I re-checked the parts that touch the new logic live (below).
- **Origin and migrations:** `origin/main` (fetched now) is `273c0b0c9`. `git merge-tree --write-tree HEAD origin/main` is clean. The newest migration on `origin/main` is V133, so V134 is still free.

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/openspec/changes/shell-rail-context-list/evidence/skeptic-final-2/`
- `active-folder-collapsed-1280-light.png`
- `folder-revealed-1280-dark.png`

### What I verified (with evidence)

**CR1 (dead toggle on the active dashboard's folder): FIXED, verified live on 7006/9913**

Servers: `start-servers.sh` READY, then `assert-phase.sh servers` PASS. I signed in as matt@helio.dev at 1280px.

1. **The bug is gone.** I created a folder "SkepticR2" with the UI's New folder button, then used the row's "Move to…" to file the active dashboard "HEL-1189 Skeptic Verify" into it. The toggle showed `aria-expanded="true"`. One click collapsed it:
   - `aria-expanded="false"` and the active row was removed from the DOM.
   - The server stored `collapsed: true`.
   - Screenshot: `active-folder-collapsed-1280-light.png`.
2. **Across a reload.** I reloaded with the folder saved collapsed and the active dashboard inside it. The folder was revealed (`true`, row visible). With an XHR/fetch spy installed, I clicked three times: `false` → `true` → `false`, with exactly 3 `PATCH /api/dashboard-folders/8553d0b4…` requests. The server ended at `collapsed: true`. Every click flips what is shown, and each one sends the inverse of what was shown, which is what round 1 asked for.
3. **Navigating into a collapsed folder from another section reveals it.** From `/pipelines`, I navigated in-app (router popstate) to `/dashboards/e8998640…` ("HEL-1027 live verify dashboard"), which I had filed into the collapsed folder. The folder was revealed, the row was `aria-pressed`, and the rail's Dashboards item was active (`folder-revealed-1280-dark.png`).
4. **Leaving and returning to the same open dashboard keeps the user's collapse.** After collapsing, I went Pipelines → rail Dashboards. The folder stayed collapsed, because the reveal key (open dashboard, its folder) had not changed. I judge this correct: the user's explicit collapse is honoured.
5. **Code read** (`DashboardList.tsx:262-274`, `:612-619`; `DashboardFolderGroup.tsx:110-115`). The reveal is keyed on `${selectedDashboardId}:${activeFolderId}` and uses React's adjust-state-during-render pattern. `onToggle` removes the folder from the revealed set before dispatching `collapsed: expanded`. There is no path left where the shown state and the sent state disagree.
6. **The tests are red against the old code.**
   - The old expression `!folder.collapsed || dashboards.some(d => d.id === selectedDashboardId)` keeps `aria-expanded="true"` after the click. So the new jest test "collapses the folder that holds the open dashboard…" (its `waitFor(... "false")`) and the new Playwright case (it expects `false` after a reload and a click) would both fail on it.
   - The third jest test ("does not reveal a collapsed folder the open dashboard is not in") guards against an over-broad reveal.
   - The old test at `:97`, which asserted the buggy behaviour, is gone.

**CR2 (false comments): FIXED, figures recomputed**

I computed WCAG relative-luminance ratios myself from the `theme.css` token values (dark: bg #0f0e0d, surface #1a1816, soft #161514, strong #262320; light: #f4f2ed, #fdfcfa, #efece6, #ffffff). The ratios:

| Pair | Dark | Light |
| --- | --- | --- |
| soft on bg | 1.057 | 1.054 |
| surface on bg | 1.089 | 1.091 |
| strong on bg | 1.234 | 1.119 |
| strong on soft | 1.167 | 1.179 |
| soft on soft | 1.000 | 1.000 |

How the comments compare:
- **`DashboardList.css:103-108` and `:491-492`** (1.000 / 1.167 / 1.179, backdrop soft #161514 / #efece6) match exactly.
- **The live context-list backdrop** measured `rgb(22, 21, 20)` = #161514 in dark, and the rail measured `rgb(15, 14, 13)`.
- **The `.context-list` dark overrides** at `:114`, `:335`, `:499` and `:758`, plus `ContextList.css:53-58`, really do use `--app-surface-strong`, so the comment's "therefore use strong" is true.
- **`AppRail.css:70-71`** (1.057/1.054, 1.089, 1.234/1.119) matches. It is incomplete but not false: light surface-on-bg, 1.091, also misses 1.10.
- **`AppRail.tsx:56` and `BottomNav.tsx:24`** now say `/home`, which matches `homeAlias.to`.
- **No stale claims remain in the changed files.** `grep` for `rgb(26,24,22)` / `1.030` / "aliases `/`" finds no hits in this change's files. The remaining `1.030` hits (`App.css`, `PreferencesEditor.css`, `PipelineDetailPage.css`) are pre-existing soft-on-surface notes, and 1.03 is correct for that pair.

**Gates, re-run by me on `1f1c32aea`**

- `npm run lint` exit 0. `npm run typecheck` exit 0. `npm run format:check` exit 0.
- Targeted jest (`nice -n 19`, `--maxWorkers=3`) over shell/, AppShell, DashboardList*, dashboardFoldersSlice, authSlice, BottomNav, UserMenu, SourceDetailPanel, PipelineDetailPage and App.test: **32 suites, 487 tests passed**. That is +2 over round 1's 485, matching the 1 replaced test plus 2 added.
- Playwright `e2e/hel1574-shell-rail.spec.ts` (`DEV_PORT=7006 BACKEND_PORT=9913`, 1 worker): **11 passed**, including the new active-folder case. This also re-proves the round-1 areas end to end:
  - rail at 769/820/1280 with no bottom nav;
  - 768 is the phone shell, with Home first;
  - 375 tab widths;
  - keyboard resize and reload persistence;
  - a drag clamps and issues one write;
  - collapse to rail-only keeps sections one click away, and survives a reload;
  - folders create/file/reload;
  - the Pipelines list is not a copy of the table.
- The backend is unchanged since evaluation-2 (sbt 8106/0 failed) and round 1's RLS review, so I did not re-run it.

**Acceptance criteria**
- **AC1:** MET. Round 1 verified it, and the rail code is unchanged except a comment. Re-proved by Playwright tests 1–3 and 8.
- **AC2:** MET. Unchanged. Re-proved by tests 6–8. Live `/me` after my session: width 248, collapsed false, accent #eab308 intact.
- **AC3:** **now MET.** Create, rename (round 1), collapse (fixed, above), move ("Move to…" live, above), server persistence with schema, RLS and tests (round 1, unchanged).
- **AC4:** MET (unchanged; Playwright test 10).
- **AC5 and the phone Home ruling:** MET (unchanged; tests 4–5).
- **Owner rulings** (200/248/400, no hardcoded accent or fonts, `--app-surface` #1a1816, static indicator, glass BottomNav, Home → `/home`, Usage in the avatar menu, per-user folders, server-side shell prefs): unchanged since round 1, which verified each one. The only CSS change since then is a comment.

**Design judgment:** the delta adds no new UI. In both themes, the collapsed and revealed folder headers use the same chevron/name/mono-count treatment as round 1, and the active row keeps its accent wash plus dot (screenshots above).

### Verdict: CONFIRM

### Non-blocking notes
- **Gate-chain observation for the orchestrator.** `workflow-state.md` records `LAST_EVAL_REPORT: evaluation-2.md`, which reviewed `31b11d02a`. No evaluator report covers `1f1c32aea`. I covered the gap for the changed areas myself (lint, typecheck, format, targeted jest and the shell Playwright spec are all green on `1f1c32aea`). However, the full jest, sbt and Playwright suites were not re-run on this commit by anyone. The delta is frontend-only and limited to the files listed above, but check-merge-readiness should be aware of this.
- **The spec text no longer matches the shipped behaviour.** `specs/dashboard-folders/spec.md:57` says "The active dashboard's folder SHALL be expanded". Since CR1 the user can collapse it, and it is re-revealed on reload or when navigating into it. Consider re-wording before archive, for example: "is revealed when the user navigates to (or reloads on) a dashboard in a collapsed folder; the disclosure always toggles what is shown". Then the "Collapse persists across reloads" scenario reads unambiguously: the saved state persists, and only the folder holding the open dashboard is re-revealed.
- **Reload versus section-switch asymmetry.** A collapsed folder holding the open dashboard is re-revealed on a full reload but not on an in-app return to Dashboards, because on remount the folders are already in the store and the reveal key does not change. Both outcomes are defensible, and the e2e case pins the reload behaviour. Mention it if HEL-1578's Home rework revisits this.
- **Unrelated console error during my session.** After the Playwright run, two `502` errors appeared on `/api/pipelines/905955c7…/run-events` (an SSE stream through the Vite proxy). They did not reproduce on a fresh load of the dashboard (0 console errors after 5 s), and no code in this branch's delta touches run-events. I am treating them as transient proxy noise while the e2e suite was creating and deleting users.
- The round-1 polish notes still apply and remain optional: the always-visible folder kebab, no year on the next-run label, "View all" linking to the current page, and the `as unknown as` casts.
- **Dev-data hygiene.** I deleted folder "SkepticR2" (204), and folders/assignments are back to empty. The two dashboards I filed are unfiled as a result. Prefs are unchanged (248 / false). I re-opened HEL-1189 as the selected dashboard. Playwright deleted its 11 throwaway users. The servers were stopped with `stop-servers.sh` (`STOPPED ports=7006,9913`), and the browser is closed.
