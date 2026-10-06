# HEL-1300 inventory — seed-while-`/`-is-live audit

Status: complete (tasks 1.1-1.4, 2.x, 3.1-3.4). The original ESCALATION (both guards affected) was answered by the owner
via the driver: leave the guards to #774 and continue (standing constraints C8, C9 in tasks.md).
Line numbers are from the unmodified specs. Verdict vocabulary is design D1: `NE` not-exposed, `EU` exposed-unobservable,
`A` affected. W = UI login complete (`waitForURL("/")`) to the test's next full document load.

Labels used below: **[C8]** = deliberately NOT edited (HEL-1298 owns the file); **[code-read]** = verified by code reading only
(C9: quarantined by `playwright.config.ts` `testIgnore`, or opt-in regression harness that rewrites product CSS), the fix is
applied but could not be run; 

## 1.1 Live `/` read set (no navigation after login)

| # | Fetch / effect | Trigger condition | Source |
|---|---|---|---|
| R1 | `GET /api/dashboards`; `fetchDashboards.fulfilled` auto-selects the most recent dashboard | always, once on App mount | `frontend/src/app/App.tsx:174-176` |
| R2 | `fetchPanels(selectedDashboardId)` | once a dashboard is selected (R1) | `App.tsx:178-184` |
| R3 | `PanelGrid` effects for the selected board: `useStoredLayoutRepair` (owner `POST .../layout/repair`), `useOutputMeta` (`GET /api/outputs/:id`), `usePanelData` rows, `usePanelRunRefresh` SSE subscription, `useFirstDashboardRendered` (`POST /api/events`) | selected dashboard has panels (and, for the repair, a repairable breakpoint) | `PanelGrid.tsx:67`, `useStoredLayoutRepair.ts:45-60`, `useOutputMeta.ts:20`, `usePanelRunRefresh.ts:25-28`, `PanelCard.tsx:150`, `useFirstDashboardRendered.ts:15` |
| R4 | Recent-visit recorder writes the auto-selected dashboard to localStorage (survives a later goto/reload) | `selectedDashboardId` transition to non-null (R1) | `recentVisitsListeners.ts` `registerDashboardVisitListener`, registered `store.ts` |
| R5 | `fetchSources()` + `fetchPipelines()` | onboarding checklist `visible` (`active \|\| autoActivate`) AND that collection's status is `"idle"` (one shot). `autoActivate` = dashboards fetched, zero dashboards, `dismissed === false` (a fresh user). `active` is sticky once set | `useOnboardingHost.ts:64-65, 83-92`; mounted by `PanelList.tsx:55` |
| R6 | Sidebar per-section fetch (sources / pipelines / conversations; source references) | route section is sources/pipelines/chat. **Not met on `/`** (section is dashboards) | `SidebarBody.tsx:62-68, 71-73` |
| R7 | Palette indexing (dashboards/sources/pipelines/outputs) | palette `isOpen` only. **Not met** unless the test opens it | `useResourceIndexing.ts:75-87` |
| R8 | `GET /api/tokens` | only `SettingsPage` (`SettingsPage.tsx:39`). **Not met on `/`** | |

Consequence for classification (C7): for a fresh user with no dashboard, any seeded dashboard (R1), panel/layout of an
auto-selectable board (R2/R3), source or pipeline (R5; the onboarding trigger is met, so it cannot be excluded) is readable
by the live page. Only entities outside R1-R5 (tokens, auth endpoints) are `EU`.

## 1.2 Per-test classification (38 UI-login files; 8 further files have no UI login)

`quar` = excluded from a bare run by `playwright.config.ts` `testIgnore` (cannot be run locally with the untouchable
config); `opt-in` = `*.regression.spec.ts`, self-gated on an env var and it mutates product CSS on disk.
Fix sites: `call-site` = `isolateLivePage(page)` after the login call and before the first seed; `in-login` = inside the
local `registerAndLogin` (every caller affected, none uses the live page; D3).

| File (tests) | Login | First seed | Next load | Verdicts | Reason / fix |
|---|---|---|---|---|---|
| auth-cookie-migration (8) | :65 :107 :154 :178 :201 :235 :265 :313 | CSRF test `page.request.post /api/dashboards` :208; PAT test `POST /api/tokens` :269 | none (test ends) | NE x6; **A** x1 (CSRF :186); **EU** x1 (PAT :250) | A: dashboard seeded while `/` live (R1). EU: tokens only read by Settings (R8); R5 reads sources/pipelines, not tokens; R6/R7 triggers not met on `/` (no navigation, palette never opened). Fix A: call-site isolate after :201 |
| hel1003 (4) | :30 | none (UI "Add dashboard") | n/a | NE x4 | no API seeding after login |
| hel1007 (1) | none (`page.request` register :54) | n/a | goto :98 | out of population | page is blank until its first goto; no live `/` |
| hel1023 (5) | :77 (in `registerAndLogin`) | `seedDashboard` :373 (beforeEach) | `goto` in `openAt` :361 | **A** x5 | dashboard+panels seeded; R1-R3 incl. repair POST before `stubOwnerRepair`. Fix: isolate in `beforeEach` (hunk disjoint from #774's :74 and afterAll hunks). D4: `PATCH` listener attached after seed; the live `/` cannot send a counted PATCH; no move |
| hel1028 (13) | :36 | `seedDashboard` :170/:219/:245/:268 | `goto` in `openDashboard` :79 / :270 | **A** x13 | same; call-site isolate at the four call sites. D4 listener counts only `PATCH .../update`, never sent by the idle live page |
| hel1065 (5) | :49 | `seedPinnableTablePanel` :61 (dashboard, source, pipeline, output, run, panel) | `goto("/")` :138 | **A** x5 | R1-R3,R5. Fix: isolate at top of `seedPinnableTablePanel` (all 3 callers affected). The `reload` at :160 (`setTheme`) is after the :138 goto, outside W, unchanged |
| hel1079 (5) | :24 | `createDatasetSourceViaApi` :42 (tests 2-5) | `goto /sources/:id` | NE x1 (create); **A** x4 | source seeded for a no-dashboard user: R5 trigger met. Fix: call-site isolate in tests 2-5 (test 1 is NE, so the helper is not changed) |
| hel1080 (4) | :25 | `createDatasetSource` :39 | `goToSource` :52 | **A** x4 | R5; all callers affected; fix `in-login` |
| hel1085 (1) | :26 | dataset :34, dashboard :57, panel :71 | `goto("/")` :142 | **A** | R1-R3, R5; call-site |
| hel1087 (4) | :27 | :35/:55/:68 | `goto("/")` :161/:219/:263; test 1 never loads | **A** x4 | `in-login` |
| hel1088 (1) | :28 | :36/:54/:67 | `goto("/")` :134 | **A** | `in-login` |
| hel1090 (5) | :27 | :42/:67/:80 | `goto("/")` :159 :263 :338 :383 :439 | **A** x5 | `in-login` |
| hel1094 (1) | :40 | :56 dashboard ... :137 auto-layout | `goto("/")` :148 | **A** | `in-login`. Spec comment says no `reload` anywhere (:169,:177) |
| hel1095 (4) | :30 | :38/:56/:69 | `goto("/")` :138 :216 | **A** x4 | `in-login` |
| hel1096 (2) | :35 | :43/:93/:100 | `goto("/")` :160 :215 | **A** x2 | `in-login`; `page.route` at :206 only attaches a handler, uses no live page |
| hel1169 (4) | :32 | :40/:58/:71 | `goto("/")` :125 :185 | **A** x4 | `in-login` |
| hel1189 (2) | :26 | `seedOrdersOutput` :34 | `goto("/")` :120 | **A** x2 | `in-login`; theme `addInitScript` survives |
| hel1230 (1) | :23 | `seed` :28 (dashboard, panel, layout PATCH, source, pipeline, output, run) | `goto /dashboards/:id` :92 | **A** | R1-R3. D4: `PATCH .../update` counter attached :87 after seed; the idle page sends none; no move. `in-login` |
| hel1260 (4) | 2c49bdba fix | | | already isolated (about:blank + listener before login) | verified, not edited |
| hel503 (6) | :37 | dashboard :39 (in `registerAndLoginWithDashboard`), plus source/pipeline/output | `page.reload()` :103 :122 :151 :177 :201 :225 | **A** x6 | R1-R3,R5. Reload purpose (quoted, :100-101 "Reload lands fresh on `/` with an EMPTY client-side Redux store"). Decision D2a: `isolateLivePage` in the helper + `page.goto("/")` replacing each reload; the goto is the same full document load on `/` with an empty store, so the primary-acceptance premise (no navigation between login and search other than that load) is preserved. Test 5 `page.route` stays before the load |
| hel510 (7) | :25 | none | n/a | NE x7 | no seeding |
| hel516-palette-quick-create (10) | :27, inline :292 | panel-reach :84 dashboard; panel-owning :149; strictmode :214 source; parity :294 | `goto("/")` / `/sources` | NE x6; **A** x4 | registerAndLogin ends with a live-page wait ("Add dashboard", HEL-1030), so call-site isolate after it. #774 touches only the header hunk |
| hel516-screenshots (2) | :16 | none | n/a | NE x2 | no seeding |
| hel519-recent-navigation (8) **[C8: not edited]** | :32 (+ wait for "Add dashboard") | :37/:46 source/pipeline; dashboard :146 | goto :88 :107 :126 :169 :207 :231; reload :153 | NE x1 (fresh); **A** x7 | R5 (sources/pipelines, no dashboard) and R1/R4 (dashboard). t4 "a full reload's auto-selected dashboard": reload :153, quoted purpose "a full page RELOAD landing on `/`, exercising `fetchDashboards.fulfilled`'s auto-select"; the live page can record the visit (R4) before the reload, making it vacuous. D2a: `isolateLivePage` + `page.goto("/")`. Reload :182 (t5) is after goto :169 so outside W |
| hel519-screenshots (2) | :18 | source :39 | `goto /sources` :50 | **A** x2 | R5; call-site |
| hel572 (3) | :32 | `seedChartPanel` :42 | `goto("/")` :200 :242 :286 | **A** x3 | `in-login` |
| hel588 (4) | :31 | :48 / :405 / :593 | `goto("/")` :248 :330 :519 :754 | **A** x4 | `in-login` (not a #774 hunk) |
| hel665 (1, quar) | :41 | none | goto /chat | NE | no seeding |
| hel666 (2, quar) | :33 :89 | dashboard :37; source/pipeline :93 :105 | `goto("/")`:48/:121 | **A** x2 | **[code-read]** call-site |
| hel716 (1, quar) | :51 | dashboard :53, panel :62 | `goto("/")` :68 | **A** | **[code-read]** call-site |
| hel773 (11) | :30 | dashboards :59 :110 :210 :247 :299 :332 :370 :445 | `goto("/")` | **A** x11, all fixed | Call-site isolate in 7 tests. Matrix tests (:442) set `localStorage` on the live page first, so isolate goes after that step and before the seed. `iconsize` (:209): isolate after login, seed, then `page.goto("/")` before the theme loop so its `page.evaluate(localStorage)` runs on the app origin (isolate -> seed -> goto -> evaluate, the sequence #774's guards should adopt). A first attempt with the isolate inside `registerAndLogin` failed these 5 tests 50/50 (C3, SecurityError) |
| hel813-floor (14) | :41 | surfaces 1,6 dashboard :97 :272; surface 5 source :239 | `goto("/")` :102 :277; `/pipelines` :249 | NE x8 (surfaces 2,3,4,7); **A** x6 | call-site on surfaces 1, 5, 6 |
| hel813-regression (2, opt-in) | :48 | Case B dashboard :262 | `goto("/")` :267 | NE (Case A); **A** (Case B) | **[code-read]** call-site in Case B; running it rewrites product CSS (C1), so not run |
| hel520-regression (2, opt-in) | :61 | Case B source/pipeline :270 :281 | goto :288 | NE (Case A); **A** (Case B) | **[code-read]** call-site in Case B; opt-in, not run. Case A inline login seeds nothing |
| hel908-full-flow, step-card-split, tail-attach, trunk-reorder-drag, trunk-reorder-order, hel912, hel958 (7 files) | none (`page.request` register) | n/a | first goto is the route under test | out of population | no live `/`; page blank until first goto |
| hel909 (4, quar) | :31 | `seedThroughputOutput` :39 | `goto("/")` :106 :180 :219 | **A** x4 | **[code-read]** `in-login` (all 4 callers affected) |
| hel910 (2) **[C8: not edited]** | :66 | t1 dashboard :101; t2 :216-241 | goto /pipelines :113 ; `goto("/")` :247 | **A** x2 | t1 is the HEL-1298 hel910:90 test; see 3.3 |
| hel968 (3, quar) | :37 | t1 none before goto /pipelines :48; touch-target x2 :198 :210 | | NE x1; **A** x2 **[code-read]** (call-site in the 2 touch-target tests) | t1's later dashboard seed :168 happens on `/pipelines/:id` (not `/`), and its `reload` :144 follows goto :48 (outside W) |
| focus-presence-guard (1) | :54 | UI dashboard create :160-165, then API source :167, pipeline :178 | goto per route :240 | see 1.3 | |
| state-surface-contrast-guard (1) | :85 | UI dashboard create :524-530, then API source :541, pipeline :558, step :571 | goto :621 | see 1.3 | |


## 1.3 The two guards (design D7) — BOTH VERSIONS AFFECTED; owner ruling: leave to #774, do not edit

Neither guard is edited (C1; ruling `leave-guards-to-774-and-continue`).

- **main version (verdict: A, formally).** Seeds the first dashboard through the UI (page interaction, not an API seed), then
  a source (`focus-presence-guard.spec.ts:167`, `state-surface-contrast-guard.spec.ts:541`), a pipeline (`:178` / `:558`) and,
  in the contrast guard, a step (`:571`) through the API while the post-login `/` is live. The live page can read
  sources/pipelines through R5 (`useOnboardingHost.ts:83-92`). That trigger is one-shot per collection and `active` is sticky;
  `registerAndLogin` only waits for "Add dashboard" (`focus-presence-guard.spec.ts:55`), which renders before the first
  dashboards fetch resolves, so C7's "show the trigger is not met" cannot be satisfied. Practical likelihood is low.
- **#774 head 9ee0f3e9 (verdict: A, unambiguous).** `addCookies` + `goto("/")` + "Add dashboard" wait, then
  `request.post("/api/dashboards")` (R1: the live page auto-selects a dashboard created after the load), then source and
  pipeline, then a `page.evaluate(localStorage.setItem)` on the live origin, then a goto per route.
- **For the PR body: the fix sequence #774 should adopt** is `isolateLivePage` (right after the "Add dashboard" wait) -> API
  seed (dashboard, source, pipeline, step) -> `page.goto("/")` -> `page.evaluate(localStorage.setItem theme)` -> per-route
  goto. The `evaluate` must move to after a `goto` of an app route (C3: it fails on `about:blank`, measured on hel773 here).

## 1.4 Exposure probe (unmodified specs, `--trace on --repeat-each 3 --workers 2`, 375 runs, all passed)

Method: scratch parser (not committed) over each trace. W = first non-auth mutating `APIRequestContext` call after the
page-frame `POST /api/auth/login` to the next `goto`/`reload`; observing run = a page-frame (resource snapshot with a
`pageref`, never an `APIRequestContext` entry) `/api/` request inside W. Frame attribution spot-checked on one trace
(`hel1085` repeat1): 12 page-frame snapshots vs 7 `APIRequestContext` snapshots listed, identical to the `Test` `pw:api`
actions, and the sets are disjoint. Times compared ms with ms. "obs/3" = runs observing; where 0, the verdict is
"exposure by code path, not observed in 3 runs".

Per file (observing runs / runs; request kinds seen in W):
- hel1023 5 tests x 3/3 (GET dashboards, panels). hel1028 13 tests x 3/3 (GET dashboards, panels; **POST layout/repair in 11 of the 13 tests, 23 of 39 runs**, the HEL-1289 effect itself).
- hel1065 5 x 3/3 (dashboards, panels). hel1085 3/3. hel1087 4 x 3/3 (dashboards, panels, data-sources, pipelines). hel1088 3/3. hel1090 5 x 3/3. hel1094 3/3.
- hel1095 4 tests: 3/3, 3/3, 3/3, 2/3. hel1096 2 x 3/3 (dashboards, sources, pipelines). hel1169 4 x 3/3. hel1189 2 x 3/3.
- hel1230 3/3 (dashboards, panels, **repair POST in 2 runs**). hel572 8/9 runs. hel588 4 x 3/3.
- hel503 11/18 runs. hel516-palette-quick-create 3/12 (4 affected tests). hel773 9/33 runs.
- hel1079 (4 affected tests) 0/12, hel1080 0/12, hel813-floor affected surfaces 0/18, hel519-screenshots 0/6, hel519-recent-navigation 0/21: **exposure by code path (R5 sources/pipelines, whose one-shot fetch had already fired), not observed in 3 runs.**
- auth-cookie CSRF 0/3: by code path. auth-cookie PAT (EU) 3/3 observations were only the page's own initial `GET /api/dashboards` / sources / pipelines landing after the token POST; none reads a token, consistent with the EU verdict (tokens: `SettingsPage.tsx:39` only).
- hel910 existing-output test 3/3 (dashboards, panels); hel910 "New pipeline with a manually-entered table" 0/3.

Residue (all runs): every user is in `residue-users.txt` (email, id by exact-email lookup), 1725 rows.

## 2.x Fixes applied

29 spec files edited plus `e2e/support/isolateLivePage.ts`. Per file: see `files-modified.md`. Removed lines across the whole diff:
only the six `await page.reload();` lines in hel503 (D2a). Check used for C2: `git diff -U0 | grep '^-' | grep -v '^---'`
prints only that line; no `expect`, `setTimeout`, `waitFor*`, `skip` line is touched.
- In-helper isolate (all callers affected, none uses the live page): hel1080, hel1085, hel1087, hel1088, hel1090, hel1094, hel1095, hel1096, hel1169, hel1189, hel1230, hel572, hel588, hel909 [code-read], hel519-screenshots; hel503 (also D2a, below). hel1065: top of `seedPinnableTablePanel`.
- Call-site isolate: auth-cookie (CSRF test), hel1023 (beforeEach), hel1028 (4 sites), hel1079 (4), hel516-palette-quick-create (3 + the inline parity login), hel773 (7, incl. `iconsize` with a following `goto("/")`), hel813-floor (surfaces 1, 5, 6), hel666 [code-read], hel716 [code-read], hel968 [code-read], hel520-regression Case B [code-read], hel813-regression Case B [code-read].
- D2a (reload -> goto("/")): hel503, six tests. Quoted purpose (`:100-101`): "Reload lands fresh on `/` with an EMPTY client-side Redux store". `goto("/")` from `about:blank` is the same full load with an empty store. No other reload sits inside the W of an edited test.
- D4: hel1023 / hel1028 / hel1230 counters: the idle live page cannot send a counted `PATCH .../update`; the attach point is unchanged.
- #774 overlap (hel1023, hel1028, hel516-palette-quick-create, hel588, hel773, hel813-floor): hunks are at the import line, the `const email` line (not the hel1023/hel1028 `seededUsers` lines), test bodies and the beforeEach; none touches #774's header-configure or afterAll hunks. hel1023/hel1028 take no email log line (D5).

## 3.1 Post-fix isolation (modified specs, `--trace on --repeat-each 10`)

Same parser, W = first mutating API call after the `about:blank` goto to the next goto (requests between the isolate call
beginning and the seed are the old document's in-flight work, sent before the navigation committed and before any seed; 5 of
the 889 windows in the first run and 21 of 150 in the second showed such pre-seed requests). **0 page-frame `/api/`
requests inside any fixed test's seed window: 884+5 windows (post1, hel773 matrix/hel1065 retaken in post2) and 129+21
(post2), 0 leaks.** hel773 `iconsize` (cycle 2): 10 traces, 10 isolated, 0 leaks.

## 3.3 HEL-1298 / HEL-1294 (D8)

- hel519 "visiting a source from its list" (hel519:84, click at :90): affected by code reading (source seed, no dashboard: R5).
  Probe: 0/3 runs observed any page-frame request in W. The failing step is a click on the row of a **fresh** `/sources`
  load, which discards the live `/` store, so the seed seen or not seen by the old page cannot change it. No evidence links
  it to this race. **Not edited (C8).** Reload plan for HEL-1298 (hel519 t4 "a full reload's auto-selected dashboard", :141):
  `isolateLivePage` after the "Add dashboard" wait, then replace `page.reload()` (:153) with `page.goto("/")`.
- hel910 "New pipeline with a manually-entered table" (hel910:90): affected by code reading (dashboard seed :101).
  Probe: 0/3 observing. Whole-test timeout shape under contention; no direct link. **Not edited (C8).** The sibling test
  "empty-state Add panel CTA" showed 3/3 observing runs (dashboards/panels), so its isolation would be correct, but it is also in the C8 file.
- hel958 (HEL-1294): no UI login at all (`page.request` register :19, first goto :72), so no exposure shape; HEL-1294 was
  fixed as a product bug (d9473814, #778). Confirmed.
- No direct causal link found; no C5 escalation.
