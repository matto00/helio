## Context

HEL-1585 (filed 2026-10-14) saw `scrollHeight` 2518 vs `innerHeight` 900 on a pipeline detail page in an emulated
browser pane. Since then the shell became the HEL-1574 grid (`.app-shell` `height: 100vh; height: 100dvh`,
`grid-template-rows: auto minmax(0, 1fr)`, `.app-content` `overflow-y: auto; min-height: 0`) and the pipeline page
became the HEL-1579 spine. `html, body, #root` use `min-height: 100dvh` (theme.css), so if anything inside the shell
ever exceeds the shell's bound, the document becomes the scroll container. Today only `/pipelines/:id` has a
document-scroll check (`e2e/hel1579-pipeline-spine-layout.spec.ts`, short seeded step list, default context list);
the phone layout has its own requirement (`mobile-app-shell-anchoring`). No guard covers any other desktop route, a
long step list, or a 30+ item context list.

## Goals / Non-Goals

**Goals:** reproduce or rule out the report with per-route numbers; one small guard for every authenticated route at
1440x900 and 1280x800; a wheel check over the step spine; a fix only when the cause is shell-level.

**Non-Goals:** phone widths (covered by `mobile-app-shell-anchoring`); horizontal overflow; the public viewer and
signed-out pages (`/dashboards/:id/panels`, `/login`, landing); modals and popovers (`modal-body-scroll-extent`,
`popover-viewport-fit`); any Playwright config change (HEL-1816 may change the config in flight; this change adds a
spec file only).

## Decisions

**D1. Reproduce first, on the lane dev server, with the guard itself.** The guard is written first and run against
unmodified `main` (red-first, C12). Its per-route measurements (`scrollHeight`, `innerHeight`, `scrollY` per route
per viewport) are written to an evidence JSON via `evidencePath("HEL-1585", ...)` and the run output is committed as a
`.txt` before any implementation code. The branch is at main (c405b6817) at that point; the evidence file says so. If every route passes on `main`, the report is ruled out for the current
layout, and the committed run is the evidence; the guard is still kept (the ticket asks for it either way).

**D2. Seed per viewport test, as realistically as the report.** Each of the two viewport tests registers its own
fresh user (`registerAndLogin`, cleaned up by the HEL-1301 global teardown), so each test has its own per-user
rate-limit bucket (`RATE_LIMIT_REQUESTS_PER_WINDOW` = 120 / 60 s). Each user is seeded over HTTP through one shared
seed helper: one static source; 32 pipelines on that source so the Pipelines context list is 30+ items long, each
created with the single-call `POST /api/pipelines` body (steps inline) so one pipeline costs one request; one of them
with a long step list (at least 20 steps) and one with a short (1-2 step) list; one dashboard with a few Output panels
bound from the long pipeline, so `/dashboards/:id` renders real panels. The seed helper counts its own requests and
returns that count (`seedRequests`); see D4a for how it enters the budget. If the single-call body cannot carry inline
steps for some step type, the executor uses another step type that it can, rather than per-step POSTs.

**D3. The route list is explicit, and checked against the router.** The spec hard-codes the authenticated routes,
with concrete ids for the parametrised ones: `/home`, `/dashboards`, `/dashboards/:id`, `/sources`, `/sources/:id`,
`/pipelines`, `/pipelines/:id` (long), `/pipelines/:id` (short), `/connectors`, `/chat`, `/settings`, `/admin/usage`
(renders the not-found fallback for a non-owner; still inside the shell), `/proposals/review`, `/patch-sets/review`,
`/pipeline-proposals/review`, `/combined-proposals/review`, `/connect/mcp`. A cheap first assertion reads
`frontend/src/app/AppRoutes.tsx` from disk, extracts every `path="..."` inside the `ProtectedRoute` element, and fails
naming any path the list does not cover. The review pages render their empty/no-proposal state; that is still a real
page in the shell, which is what this invariant is about.

**D4. One test per viewport, client-side navigation, soft collection, one final assertion.** Two tests (1440x900,
1280x800), each on one page: the tour starts on the app route `registerAndLogin` lands on (no extra `page.goto`; at most one
`page.reload()` after the seed if the already-booted app does not show the seeded lists, and that reload is counted
by D4a like everything else), and every route is reached by client-side navigation (clicking the rail item or the context-list / overview link for that route where one exists; otherwise
`window.history.pushState` + a `popstate` dispatch, which React Router honours), never a full reload per route, so the
app's boot fetches happen once. On each route the spec waits for a route-specific ready landmark (a visible heading or
region, bounded timeout, never a fixed sleep; `/connect/mcp` with no `?request=` uses whatever its early-return state
renders, per `ConnectMcpPage.tsx`, not a consent-form element), then two animation frames, then records
`scrollHeight`, `innerHeight`, `scrollY` and whether the dashboard tab bar (`.app-shell--tabs`) is present. All
offenders are collected and asserted at the end in one message listing every failing route, so a red run names every
route. The wheel check lives in the 1440x900 test: hover the step spine of the long pipeline,
`page.mouse.wheel(0, 600)`, then assert `window.scrollY === 0`, the command bar's bounding-rect top is unchanged, and
the `scrollTop` of the nearest scrollable ancestor of `document.elementFromPoint(x, y)` at the hover coordinates is
greater than 0. Which inner
element that is (the spine list or `.app-content`) is found by measurement in D1 and stated in the PR.

**D4a. Rate-limit budget, asserted.** `attachApiRequestCounter(page)` is attached before `registerAndLogin` in each
test, following `e2e/hel1632-live-output.spec.ts:203-214`. The counter wraps both browser requests and
`page.request.fetch` (`e2e/support/apiRequestCounter.ts:89-99`), so the seed MUST go through `page.request` (never the
separate `request` fixture, which would be charged to the same session bucket but not counted). Each test asserts
exactly what hel1632 asserts: `count429 === 0` and `maxWindow <= MAX_WINDOW_TARGET` (90); `maxWindow` already
includes the seed calls in whatever window they fall in. The seed helper's own count (`seedRequests`) is recorded
only, not added to the assertion. `seedRequests`, `maxWindow` and `count429` go into `evidence/ci-cost.txt`.
Budget savings that are always applied: no extra `page.goto` after login (`registerAndLogin` already lands on an app
route, `e2e/support/auth.ts:82-96`; the tour starts there by client-side navigation). If a real run still measures
`maxWindow > 90`, the remedies, in order: (1) split the route tour across the two viewport tests' users is NOT
allowed (each viewport must cover every route), so instead trim browser traffic (navigate by `pushState` rather than
clicks that open previews; avoid routes' optional fetches such as opening a step editor); (2) seed through a separate
`APIRequestContext` authenticated by a personal access token, which is keyed by token id, a different bucket from the
browser session (the executor must first confirm that keying in `RateLimitDirective`/its key extraction before relying
on it, and count those calls separately in the evidence); never by sleeping to wait out a window, and never by
dropping a route or the 30+ pipeline count.

**D4b. Preconditions, so the guard cannot pass vacuously.** Before the document measurement on each route that depends
on the seed, the spec asserts the condition that makes the check meaningful, failing with a message naming the route:
- on `/pipelines`, the overview lists at least 30 seeded pipelines. (Execution finding: the Pipelines and Sources
  context lists are hard-capped at 8 rows each, `MAX_ROWS` in `frontend/src/app/shell/ScheduledContextList.tsx`, so the
  ticket's "30+ sidebar pipeline list" can no longer exist; the context list that still scales with data is the
  Dashboards one.) So each user is also seeded with at least 32 dashboards, and on `/dashboards` and `/dashboards/:id`
  the Dashboards context list renders at least 30 items before measuring;
- on the long `/pipelines/:id`, at both viewports, the spine's inner scroll region (or, if the spine does not own a
  scroller, `.app-content`) has `scrollHeight > clientHeight`, so content really overflows and the document stays put
  only because the shell bounds it;
- on `/dashboards/:id`, the seeded panels are visible (count equal to the seeded count);
- on every route, no visible error state ("Something went wrong" / a failed-load message) is rendered, and
  `count429 === 0` (D4a).

**D5. A guard must be failable.** Beyond the red run on `main` (D1), the executor proves the guard goes red under at
least two mutations, run and recorded, then reverted: (a) `.app-shell` `height` replaced by `min-height` (the shell
grows with content); the mutation output must show the long `/pipelines/:id` route named as an offender, not merely
some route; (b) the router check: remove one path from the
spec's route list and see the AppRoutes assertion fail naming it. Mutation output is committed as `.txt` next to the
red run. Mutations are temporary edits, never committed.

**D6. Fix only shell-level causes.** If D1 finds offending routes: if the cause is in the shell (`.app-shell`,
`.app-content`, the context list's container, `html/body/#root`), fix it in `frontend/src/app/App.css` /
`frontend/src/theme/theme.css` with the smallest change, and add a CSS unit assertion if `App.css.test.ts` already
covers that rule. If the cause is page-local (one page's own layout), the executor does not fix it: it lists the
route, the measured numbers and the element that overflows, and the orchestrator raises follow-up triage.

**D7. Timeout and CI cost: stated, then measured.** The config default `timeout: 30_000` cannot hold a 32-pipeline
seed plus 17 routes, so the spec sets `test.setTimeout(150_000)` on each test, the precedent of
`hel1632-live-output.spec.ts:201` for a seed-plus-many-interactions test; the expected wall time is well below it
(target: under 90 s per test locally), and the bound exists so a hung route fails as a timeout with the route named in
the step title rather than at 30 s mid-seed. The executor records each test's local wall time (2 workers, lane dev
server) in `evidence/ci-cost.txt` and the PR states it. `e2e/shard-weights.tsv` is generated, never hand-edited; a new
file gets the median weight by default, which is acceptable. If a test exceeds 90 s locally, reduce the seed, not the
route list.

**D8. Lane hygiene.** Lane-private DB `helio_hel1585` for start-servers.sh, Playwright and any cleanup; backend started
with `ANTHROPIC_API_KEY` exported empty (the `/chat` route must render without a live model call; it only loads, it
never sends). Screenshots, if any, only via `evidencePath`.

## Risks / Trade-offs

- [The report does not reproduce] -> the guard still lands; the ticket's own wording asks for it either way.
- [Route ready signals are flaky] -> each route waits on a specific visible landmark with a bounded timeout, never a
  fixed sleep; a route whose landmark cannot be found fails loudly, naming the route.
- [The AppRoutes source check is a regex over TSX] -> it only needs `path="..."` literals inside the protected block;
  if the router file is restructured the check fails loudly rather than passing vacuously (it asserts it found at
  least 15 paths).
- [Rate limits while seeding and visiting] -> one user per viewport test, single-call pipeline creation, client-side
  navigation, the seed through `page.request` so the counter sees it, and the D4a assertion (`count429 === 0`,
  `maxWindow <= 90`), with a PAT-bucket seed as the stated fallback.
- [Two shell layouts] -> once a dashboard tab is open the shell may be `.app-shell--tabs` (three rows) on later
  routes; that is legitimate shell coverage and the evidence JSON records which layout each route had.
