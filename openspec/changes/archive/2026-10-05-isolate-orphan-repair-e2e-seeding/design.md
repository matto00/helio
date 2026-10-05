## Context

Root cause is probe-confirmed in `probe-root-cause.md`: 10/20 failures on the unmodified spec, with a 20/20 correlation
between failure and a repair POST sent from `/` before the `goto`. The product side, read at fba0d78f:

- `frontend/src/app/App.tsx:175` dispatches `fetchDashboards()` once on mount. `fetchDashboards.fulfilled`
  (`dashboardsSlice.ts:305-326`) auto-selects `getMostRecentDashboardId` when nothing valid is selected. App then
  `fetchPanels(selectedDashboardId)`.
- `AppRoutes.tsx:108` renders `PanelList` at `/`, so the selected board's `PanelGrid` mounts there, and with it
  `useStoredLayoutRepair` (once per dashboard per mount, owner-only, after panels load, only if a breakpoint is repairable).
- HEL-1233 design D4 places the trigger in `PanelGrid` deliberately. The owner ruling says "opens", not "opens via
  `/dashboards/:id`", and the HEL-1260 `extend-owner-repair` widened it to orphans. An owner landing on `/` with their most
  recent board shown has opened it. **The repair on `/` is intended. The product is correct.**

The spec registers via the `request` fixture, logs in through the UI (`waitForURL("/")`), then seeds the dashboard, the text
panel and the layout clear through `request` while the `/` page is still live. It attaches `page.on("request")` only just before
`page.goto('/dashboards/<id>')`. Whether `/` observes the orphan first is a race.

## Goals / Non-Goals

**Goals:** make the spec deterministic without weakening it. It must keep proving exactly one repair POST over the test, its
body carrying all four breakpoints, every breakpoint stored, a reload-stable position, and no layout PATCH.

**Non-Goals:** any product change; `playwright.config.ts` / `ci.yml` (HEL-1288); quarantine; other specs (follow-up).

## Decisions

**D1 — Idle the page during seeding: `await page.goto("about:blank")` right after `registerAndLogin`, before any API
seeding, in both tests.** On `about:blank` no app code runs, so nothing can fetch, select or repair while the board is
created, populated and cleared. The session cookie lives in the browser context and survives. `addInitScript` (the theme)
re-applies on the later `goto`. The explicit `goto('/dashboards/<id>')` is then the first and only app load that can see
the orphan, so it is the owner-open the spec means to test.

Alternatives rejected:
- *Listener before login only (the comment's first candidate).* This does not remove the race. If `/` reads the board between
  `POST /panels` (item stored) and the layout clear, or reads a pre-panel layout and the post-create panel list, it can send a
  repair whose `expectedLayout` is stale (409, not applied). The clear then re-orphans the board, the `goto` repairs again, and
  the test sees two POSTs, failing "exactly one" for a reason the product handled correctly.
- *A fresh page in the same context.* The old `/` page stays alive and still races, unless it is closed first, which is
  equivalent to D1 but heavier.
- *A fresh context.* This needs a second login (cookies are per context). It is heavier, and it changes what `registerAndLogin`
  means for the file.
- *Seed before the UI login.* `/` would then deterministically auto-select and repair. The test would exercise `/`, not the
  explicit route, and would couple to most-recent-selection ordering.
- *Park on a non-grid route (e.g. `/sources`).* App.tsx still runs its mount fetches there. It relies on that route never
  mounting `PanelGrid`, a weaker invariant than "no app code runs".

**D2 — Attach the request listener before login, and count every `POST .../layout/repair` (regex
`/\/api\/dashboards\/[^/]+\/layout\/repair$/`) and every page-side `PATCH /api/dashboards/` for the whole page lifetime.**
The dashboard id is unknown before seeding, so record `{url, body}`, then assert the single POST's URL ends with
`/api/dashboards/<dashboardId>/layout/repair`. This strengthens "exactly one" from post-goto to whole-test. A repair sent
anywhere, including a regression that re-introduces an early `/` repair, is counted, and a count of 2 fails. The fresh user
owns only the seeded board, so no other board can contribute. The `request` fixture's own PATCH (the clear) is not a page
request, so it is not counted.

**D3 — The second test ("creating a text panel through the UI") gets the same D1 isolation and D2 early listener,** so its
`repairPosts` toHaveLength(0) is also whole-lifetime. Same file, same defect class.

**D4 — Every existing assertion is kept, in the same or stronger form.** That covers `toHaveCount(1)` on the grid item, the
15 s poll for exactly 1 POST, the body keys equal to all four breakpoints, all breakpoints stored with the panel, no
"Unsaved changes", the reload position within 2 px, final `repairPosts` length 1, `layoutPatches` length 0, and the
try/finally delete by exact id. No timeout is lengthened.

**D5 — Proof.**
- Red: the pre-fix baseline from the probe (10/20 failures, same command and load).
- Isolation: across the post-fix runs, traces show zero page-frame `/api/` requests between the `about:blank` navigation
  and the `goto('/dashboards/<id>')`.
- Guard, by mutation and reverted, never committed:
  - (a) `useStoredLayoutRepair` made inert, so the orphan test must go red on the poll;
  - (b) a double-dispatch of the repair, so the test must go red on the exactly-one assertion;
  - (c) the old ordering (listener after seeding, no `about:blank`), so it must flake again.
- Green: the full spec file with `--repeat-each 20 --workers 2` under `nice -n 19`, with 20 consecutive green runs of the spec
  (80 test executions). Then one CI run on the branch.

## Risks / Trade-offs

- [`about:blank` drops in-page state] → intended; the next `goto` is a full load in both the old and new flow.
- [A 409'd early repair still possible?] → no app runs during seeding, so none can be sent.
- [Other specs share the login-then-seed shape] → out of scope; noted as a follow-up for the driver, not filed here.

## Planner Notes

- Self-approved: test-only fix (the ticket's acceptance explicitly allows "fix the test and explain why the product is
  correct"); `skip_specs: true` (no behaviour change); scope limited to this one file.
- The auto-select repair on `/` was checked against HEL-1233 D4 and the HEL-1260 ruling and judged intended, so there is no
  second bug to escalate.
