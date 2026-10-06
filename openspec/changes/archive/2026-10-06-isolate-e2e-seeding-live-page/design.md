## Context

See proposal.md (Why). Mechanism, as read at main 1f35e5b4 and proven for one spec in
`openspec/changes/archive/*-isolate-orphan-repair-e2e-seeding/probe-root-cause.md`:

- `frontend/src/app/App.tsx:175` dispatches `fetchDashboards()` once on mount; `fetchDashboards.fulfilled` auto-selects the
  most recent dashboard; `App.tsx:183` then dispatches `fetchPanels(selectedDashboardId)`. `/` renders `PanelList`, so the
  selected board's `PanelGrid` mounts with its effects (`useStoredLayoutRepair`, among others).
- The recent-visit recorder (`features/commandPalette/state/recentVisitsListeners.ts`, `registerDashboardVisitListener`)
  records an auto-selected dashboard into localStorage, which **survives** a later `goto`/`reload` in the same context.
- The live `/` read set is **conditional**, not just dashboards/panels (design gate round 1): `useOnboardingHost.ts:83-92`
  fetches sources and pipelines on `/` whenever the onboarding checklist is visible, which a fresh user with no
  dashboard can be. `SidebarBody.tsx:62-68` fetches per route section, and `useResourceIndexing.ts:75-87` fetches only on
  palette open. Task 1.1 enumerates the full set with its trigger conditions.

The population is 38 e2e files with a UI form login: 34 with a local `registerAndLogin` (or `registerAndLoginWithDashboard`)
plus `auth-cookie-migration`, `hel665-message-composer`, `hel666-single-assistant-entry` and
`hel716-panel-detail-tall-viewport-footer`, which log in under another name. Some files also contain an inline login
(`hel516-palette-quick-create` around line 284, the `hel520` regression Case A).

Sibling collision: draft PR #774 (HEL-1288, head 9ee0f3e9) edits 9 of these files. In 7 of them
(`hel1023`, `hel1028`, `hel516-palette-quick-create`, `hel519-recent-navigation`, `hel588`, `hel773`, `hel813-…floor.spec`)
it only touches the header (`test.describe.configure({ mode: "parallel" })`) and `afterAll` hunks. It fully rewrites login
and seeding in `focus-presence-guard.spec.ts` and `state-surface-contrast-guard.spec.ts`, using cookie injection plus
`goto("/")` followed by API seeding while `/` is live.

## Goals / Non-Goals

**Goals:** every test that seeds while `/` is live and whose seed is readable by the live page is made deterministic by
construction, without weakening anything. The audit is recorded per test with a reason. New specs get a helper that is
correct by default.

**Non-Goals:** product changes; `playwright.config.ts` / `.github/workflows/ci.yml` (HEL-1288);
`e2e/hel1275-metric-delta-sparkline.spec.ts` (HEL-1275); a root-cause fix for HEL-1298 or HEL-1294; consolidating the 34
local `registerAndLogin` copies into one (a larger refactor that would conflict with #774; noted as a follow-up); user/row
cleanup (HEL-1301); migrating hel1260 (already fixed) to the helper.

## Decisions

**D1 — The exposure window and the classification rule, per test (not per file).**
For each test, the window W runs from the UI login completing (`waitForURL("/")`, or the equivalent landing for a
non-`registerAndLogin` login) to the test's next full document load (`page.goto(<app route>)` or `page.reload()`). Each test
gets exactly one verdict:
- `not-exposed`: no API seeding inside W. This covers seeding only before the login, no seeding at all, or a next
  statement that is the navigation. UI interaction on the live page (for example clicking "Add dashboard") is the test
  using the page, not a seeding race.
- `exposed-unobservable`: there is API seeding in W, but every seeded entity is outside the live `/`'s read set
  established in task 1.1, **under that test's actual conditions** (for example, a dashboard already exists, so the
  onboarding checklist is not visible and its source/pipeline fetch cannot fire). The verdict must cite each conditional
  fetch by file:line and show why its trigger is not met. **If that cannot be shown, the verdict is `affected`** (C7).
- `affected`: API seeding in W includes data the live page reads (dashboards; panels or layout of a board it can
  auto-select; anything else in the mount read set). The page can therefore auto-select, fetch and run effects (a repair
  POST, recent-visit recording into localStorage, telemetry, an SSE subscription) on the seed before the spec's own load.
  A test is affected whether or not a current assertion is known to be sensitive. HEL-1289's lesson is that the
  sensitivity comes from effects added later: the hel1260 repair shipped long after most of these specs were written.
Record seeding through `page.request` exactly like `request`: it is the same context but a separate client, and it does not
drive the page.

**D2 — Fix: idle the page before seeding (`about:blank`), via the helper. This is the default for every affected test.**
Insert `await isolateLivePage(page)` immediately after the UI login and before the first seed in W. On `about:blank` no app
code runs; the session cookie lives in the browser context; `addInitScript` (theme etc.) re-applies on the next goto; and
the spec's own next `goto` is the first app load that can see the seed. This is the HEL-1289 D1 fix, whose rejected
alternatives (listener-only, a fresh page, a fresh context, parking on a non-grid route) apply unchanged here.

**D2a — When W closes with `page.reload()` (or contains one before the seed is consumed), the fix is `isolateLivePage` + `page.goto("<the URL the reload would have
reloaded>")`, not `about:blank` + `reload`.** Reloading `about:blank` reloads a blank page. In the affected reload specs
(hel519 "a full reload's auto-selected dashboard", every hel503 test), the reload's stated purpose is "a fresh document on
`/` with an empty store". A `goto` of that same URL from `about:blank` is a full document load with an empty store: the
same code path (`App` mount, `fetchDashboards.fulfilled` auto-select). For each such test the executor records the
reload's purpose (quoting the spec's comment) and why the goto preserves it. If any reload's purpose is the reload itself
(for example asserting persistence across a reload of an already-loaded page), that test does not use D2a. Record it and
raise it to the orchestrator.
The reload population is wider than hel519/hel503. `reload()` also occurs in hel1007, hel1065, hel1094 (x3), hel908-trunk,
hel908-tail (x2), hel968, the hel520 and hel813 regressions, the two guards and hel1260. Only a reload inside W of an
`affected` test is in scope for D2a. For every such test the inventory records the quoted purpose and the decision
(D2a, or escalate). A reload after the spec's own first goto (for example hel1065:160, after its goto at :138) is outside
W and is unchanged. hel1094-style reloads that test persistence or SSE behaviour of an already-loaded page default to
escalation if they fall inside W.

**D2b — Seed-before-login is rejected as the default.** With the seed in place before the landing `/` loads, the login's
own landing deterministically auto-selects the seed and runs its effects. For hel519 that records the dashboard visit
before the reload under test, making the test vacuous. For specs with a repair-sensitive layout it moves the repair to the
landing page, the same coupling HEL-1289 D1 rejected. It may still be used for a test where the inventory shows the
landing-page effects are unread and harmless; the reason must be recorded.

**D3 — Shared helper: `e2e/support/isolateLivePage.ts`.**
- `isolateLivePage(page)` is `page.goto("about:blank")`. Its doc comment states the race (citing HEL-1289/HEL-1300),
  "call after a UI login, before any API seeding", and the hazard "never follow it with `page.reload()` or a
  `page.evaluate`/localStorage step before the next app `goto` (`about:blank` has no app origin)".
- `loginThenIsolate(page, { email, password })` performs the standard form login (`/login`, `#email`, `#password`,
  submit, `waitForURL("/")`), then `isolateLivePage`. It is for new specs.
- Existing specs call `isolateLivePage` at the call site (per test) rather than inside their local `registerAndLogin`,
  because several files mix affected tests with tests that rely on the live `/` after login (for example hel510,
  hel516). Putting the isolation inside a local `registerAndLogin` is allowed only when every caller in that file is
  affected and none uses the live page before its next goto; record which files do this.

**D4 — Pre-login request listeners.** HEL-1289 also moved a request listener ahead of login. That matters only when a
test counts page requests (`page.on("request")`) and the counted request could be sent by the live `/`. For each
affected test with a listener (for example hel1023, hel1028, hel1230), record whether the live page could send a counted
request before the listener attaches. If it could, the D2 isolation already removes that sender, so moving the listener
is needed only where the count is meant to cover the whole page lifetime. Do not change what a listener counts (that is
an assertion); only its attach point may move, and only with a recorded reason.

**D5 — Residue recording.** Every touched spec, except those named below, logs each throwaway email it registers
(`console.log("[HEL-1300 e2e] throwaway user: <email>")`, following the existing hel1260/hel1028 precedent). Every local
run is captured to a log file, and the exact emails, plus user ids looked up by exact email, are recorded in
`verification.md`. Untouched specs run in a probe are recorded the same way through their traces (the `#email` fill
value) or their existing log lines. Nothing is deleted.
**Exempt from the log edit:** any file whose registration lines #774 rewrites, namely hel1023 and hel1028
(`seededUsers.push(email)` becomes a console.log in #774), plus hel1260, which already logs. Their emails come from the
existing `afterAll` summary or log line on main. This keeps D7's disjoint-hunk rule intact.

**D6 — Proof.**
- *Exposure evidence (the red), on the unmodified specs:* one traced run (`--trace on`, at least `--repeat-each 3`) of
  every test classified `affected`. Using the archived HEL-1289 `probe-parse-trace.py` (adapted in a scratch copy, never
  committed), count runs in which a **page-frame** `/api/` request that reads the seed (`GET /api/dashboards`,
  `.../panels`, `.../layout/repair`, etc.) started after the first seeding request and before the test's own next
  navigation. Compare ms with ms (HEL-1289 C1). A test classified `affected` whose probe shows 0 observing runs is still
  fixed (the window exists by code reading), but the table must say "exposure by code path, not observed in N runs".
- *Isolation:* traces taken **on the modified specs** show zero page-frame `/api/` requests between `about:blank` and the
  next goto, for every fixed test.
- *Frame attribution (both probes):* a page-frame request is a trace `resource-snapshot` entry whose `pageref` (or frame
  id) is the test page's. The `request` fixture and `page.request` (APIRequestContext) calls are recorded as `action`
  entries of class `APIRequestContext` and carry no page-frame resource snapshot. The adapted parser must classify by
  that field, not by URL, and its classification must be spot-checked on one trace by listing both sets.
- *hel1260* (already isolated by HEL-1289) is verified, not edited. Its row in the inventory cites the 2c49bdba fix.
- *Green:* `nice -n 19 npx playwright test <touched specs> --repeat-each 10 --workers 2` against this worktree's own
  servers (`DEV_PORT=6732`, `BACKEND_PORT=9639`). Record per-file pass/fail counts; every failure gets triaged
  (pre-existing on main or not), never retried silently.
- *Sharding compatibility (HEL-1288):* the changes add no `beforeAll`/`afterAll` and no cross-test shared state; the
  helper is per-test. State this in `verification.md`. CI runs on this branch use main's current config. One green CI run
  is required.

**D7 — #774 collision handling.**
- `focus-presence-guard.spec.ts` and `state-surface-contrast-guard.spec.ts`: audit both versions, main and #774's head.
  Do not edit either guard. If either version is `affected`, record it and raise it to the orchestrator as a driver
  question rather than editing.
- The other 7 overlapping files may be edited, but keep hunks out of #774's (file headers, `afterAll`, the
  `seededUsers` lines) so the merge stays mechanical. Note the overlap in the PR body.

**D8 — HEL-1298 / HEL-1294.** Record the verdicts for hel519 "visiting a source from its list" (the HEL-1298 hel519:90
test) and hel910 "New pipeline with a manually-entered table" (hel910:90), plus whether either failure mode is plausibly
this race, with evidence (the probe count, what the failing step depends on). Applying the generic D2 isolation to a test
the audit classifies `affected` is in scope even when that test is a HEL-1298 test, but it must not be described as fixing
HEL-1298. No contention-specific change is made. If the evidence directly links a HEL-1298 failure to this race, stop and
raise it to the orchestrator before any further change. hel958 (HEL-1294) has no UI-login seeding shape per the
HEL-1294 finding; confirm and record.

## Risks / Trade-offs

- [`about:blank` followed by a reload or localStorage step] → D2a, and the constraint below; caught by the repeat run.
- [Edits colliding with #774] → D7; the guards are left untouched; the 7 other files get disjoint hunks.
- [A misclassified test left exposed] → classification is per test, with a cited reason and a probe count; the skeptic
  can re-derive any row.
- [Long local repeat runtime] → it is the AC; run it once, nice 19, 2 workers.

## Planner Notes

- Self-approved: a test-only change, `skip_specs: true`, no new dependency.
- Standing constraints are mirrored in `tasks.md`.
