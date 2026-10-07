## Context

Read at main a606a9833 (after #774 0c792eb26 and HEL-1300 e29f580cd).

- `e2e/support/isolateLivePage.ts` exports `isolateLivePage(page)` (`goto("about:blank")`) and
  `loginThenIsolate(page, creds)` (UI form login then isolate). Its HAZARD: never `reload`/`evaluate`/localStorage
  from `about:blank` before the next app-origin `goto`.
- `focus-presence-guard.spec.ts:45-58` local `registerAndLogin`: API register (cookie lands on `request`), copy
  cookies to the page, `goto("/")`, wait "Add dashboard". The cell (`:161-238`) then POSTs a dashboard, a source and a
  pipeline while `/` is live, then `page.evaluate(localStorage.setItem("helio-theme"))` on that live page, then
  `goto(route)`. The live `/` auto-selects the new dashboard and runs its effects (recent-visit recorder into
  localStorage, layout repair, SSE, onboarding fetch) — exactly HEL-1300's D1 `affected` class.
- `state-surface-contrast-guard.spec.ts:557-626` `newCell`: registers, seeds dashboard/source/pipeline/step, API
  login, copies cookies, `addInitScript(theme)`, and only then its first `goto("/")`. A fresh Playwright page is
  `about:blank`, so this cell is `not-exposed` per HEL-1300 D1. No API seeding occurs after `:616`.
- 32 files define a local `registerAndLogin` (or `registerAndLoginWithDashboard`, hel503). Variants observed: UI form
  login with/without `isolateLivePage`; with/without `expect(201)`; with/without the HEL-1300 email log line; trailing
  "Add dashboard" shell-ready wait (hel510, focus-presence); returning the email (hel1260) or `/api/auth/me` id
  (hel1275); register-only with `page.request` (hel910); nested in a `describe` (hel1094, hel1096); cookie-injection
  login (focus-presence). Corrections from skeptic-design-1: email domain is `@example.com` in hel1065, 1094, 1096,
  1189, 572, 588, 773, 813 (both), 909, 910, 968 and `@example.test` elsewhere; hel1023/hel1028 log
  `[HEL-10xx e2e] throwaway user registered: …` and hel1260 logs at its call sites; the "Add dashboard" post-login
  wait is in seven files (hel510, hel1003, hel519, hel1079, hel1080, hel516, focus-presence); hel1080 waits, then
  isolates. hel516:296's inline register is not a `registerAndLogin` function and stays out of scope.

## Goals / Non-Goals

**Goals:** focus-presence guard deterministic by construction; both guards' populations unchanged; one shared auth
helper with every former copy's behaviour preserved per call site; README usage note.
**Non-Goals:** see proposal.md. No `playwright.config.ts`, CI workflow or product change.

## Decisions

**D1 — focus-presence order.** Cell becomes: register + cookie login + `goto("/")` + "Add dashboard" wait (unchanged
login) -> `isolateLivePage(page)` -> API seed (dashboard, source, pipeline; unchanged payloads) -> `goto("/")` -> wait
for the seeded dashboard name on `/` -> `page.evaluate(theme)` -> `goto(route)` -> existing `data-theme` assertion and
`ROUTE_READY_MARKERS`. This is the ticket's literal order; the `evaluate` runs on an app origin (C3). Rejected:
seed-before-first-goto (also deterministic, but drops the existing post-login shell-ready wait and departs from the
ticket's stated order); `addInitScript` for the theme (would be fine, but changes the theme mechanism the guard asserts
against `data-theme`, beyond scope).

**D2 — state-surface-contrast.** No reordering: it already satisfies isolate -> seed -> load. Add an explicit
`isolateLivePage(page)` call at the top of `newCell`, before `newCDPSession` (a no-op on a fresh page) plus a one-line comment, so a future edit
that adds an earlier `goto` cannot silently reintroduce the race. Its theme stays on `addInitScript` (there is no live
page to `evaluate` on before the first `goto`); this is the documented, deliberate deviation from the ticket's literal
`evaluate` step for this file. Its local `registerUser` moves to the shared helper; its API-login + cookie handoff stays
local (the `/settings` audit-row population depends on the real `auth.login` event, `:607-615`).

**D3 — population proof.** "Per-view line counts" = the guards' `console.log` summary lines per view/cell
(focus-presence `:341`, state-surface `:381`, `:645`, `:702`, `:731`). Capture main's lines in task 1.1, before any spec edit, while
this worktree is still at base; capture the branch's after the edits, same servers; diff the numeric fields. Any difference blocks: determine whether main's number was race-produced (e.g. a recent-visit entry
recorded by the live page) and raise an ESCALATION rather than adjusting either side.

**D4 — Shared helper `e2e/support/auth.ts`.**
- `CSRF_HEADER`; `uniqueEmail(prefix, label?, domain = "example.test")` -> `${prefix}-${label}-${Date.now()}-${rand}@${domain}`
  (the format every copy already uses; `domain` preserves each file's `example.com`/`example.test` verbatim).
- `registerUser(request, { prefix, label?, displayName, domain?, logEmail = true })` -> `{ email, password }`;
  asserts 201; when `logEmail`, logs `[HEL-1300 e2e] throwaway user: <email>`.
- `uiLogin(page, creds)`: form login + `waitForURL("/")`, no isolate. `loginThenIsolate` is re-expressed on top of it.
- `registerAndLogin(page, request, { ...registerUser opts, waitForShell = false, isolate = false })` -> `{ email,
  password }`. Fixed internal order: register -> `uiLogin` -> (if `waitForShell`) `expect(getByRole("button", { name:
  "Add dashboard" })).toBeVisible()` -> (if `isolate`) `isolateLivePage`. This expresses hel1080's wait-then-isolate
  and every other observed combination; isolate-then-wait is impossible (blank page) and occurs nowhere.
- Each file passes exactly the flags its former local copy had (isolate only where it already isolated, HEL-1300 D3).
  Other extras stay at the call site (hel1275's `/api/auth/me` id; hel503's dashboard seed in a thin local wrapper;
  hel1260's returned email). Prefix, displayName and domain strings are preserved verbatim.
- Logging: files that already log their own line (hel1023, hel1028, hel1260) pass `logEmail: false` and keep their
  existing line verbatim (no double logging; their `afterAll` summaries/residue greps are unchanged). Every other file
  gets the helper's line (most already had the identical HEL-1300 line).
- `focus-presence-guard.spec.ts` and `state-surface-contrast-guard.spec.ts` use `registerUser` only and keep their
  local cookie handoff (UI login would add an `auth.login` audit row on `/settings`, the 24-vs-25 mechanism at
  `state-surface-contrast-guard.spec.ts:603-606`, and perturb the population).
- hel910's register-only local `registerAndLogin(page, label)` (no login) becomes `registerUser(page.request, ...)`.
- Every former local copy is deleted. Strictness changes allowed: `expect(201)` and the log line where missing (fail
  loud, nothing weakened). No other test-body change.

**D5 — README.** Add an "Auth and live-page isolation helpers" section: when to call `isolateLivePage`, its hazard,
`loginThenIsolate` for new specs, `registerAndLogin({ isolate })`, and the guard-specific ordering note.

**D6 — Verification.** Local runs `nice -n 19`, `--workers 2`, headless, this worktree's servers (DEV_PORT 6762,
BACKEND_PORT 9669); lane-private browser profile/cookies (Playwright default per-test contexts; no shared MCP browser,
no `/tmp` cookie jar). (a) Both guards `--repeat-each 10 --workers 2`, full logs kept. (b) Every default-collected
migrated spec once (`--workers 2`); `verification.md` records each file's collected/passed/skipped counts from the
JSON or list reporter, and a file with zero collected or all skipped never counts as a pass. Failures are re-run on a
base checkout to classify pre-existing vs regression. (c) Not run, by design: the two `testIgnore`-quarantined files
(`hel909-…`, `hel968-…`; no config edit per C1) and the two `*.regression.spec.ts` harnesses (env-gated; hel813's
mutates tracked source). Each is verified by `npm run check:e2e-types` plus a per-file diff showing only the mechanical
migration, and labelled "not run: quarantined/regression-only" in `verification.md` and the PR. (d) Green CI on all 4
e2e legs. Throwaway emails recorded; nothing deleted.

## Risks / Trade-offs

- 32-file mechanical refactor: wide diff. Mitigation: per-file diff limited to import + local-copy deletion + call-site
  arg shape; C2-style forbidden-change check stated in tasks.
- Population drift on focus-presence `/` if main's count included race-produced elements -> D3 escalation.

## Planner Notes

- Self-approved: test-only refactor, no new dependency, no product/CI change.
- Ticket's "~34" is 32 today (HEL-1300's 34 included copies since removed/renamed); no scope change.
