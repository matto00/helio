## Context

See proposal.md, Why, and ticket.md, Premise validation, for the CI trace. The test (`e2e/hel516-palette-quick-create.spec.ts`,
"section order determinism") loops 5 times over `clearCookies` + `registerAndLogin(page, request, {waitForShell})`
+ `openPalette` + reading `.command-palette__group-label`. `registerAndLogin` (`e2e/support/auth.ts`) registers over
the API (the cookie lands on the `request` fixture and the user is recorded for teardown deletion), logs in through
the UI form (which lands on `/home`), then, with `waitForShell`, does `page.goto("/dashboards")` and waits for the
"Add dashboard" button. CI trace per iteration: register ~0.4 s, `/login` load 1.2-2.6 s, submit + `/home` ~0.5 s,
`/dashboards` load 1.4-2.3 s, shell wait 0.3-0.7 s, palette ~0.5 s.

## Goals / Non-Goals

**Goals:** the test proves what it proved before (the declared section order on 5 independent real-browser boots)
inside its 30 s budget with wide margin on a slow runner, with no timeout or retry change.

**Non-Goals:** changing `registerAndLogin` or any other spec; changing app code (the trace shows no app defect).

## Decisions

**D1. Keep 5 boots, make each one page load.** Each iteration registers a fresh user with `registerUser(request,
...)` (recorded for cleanup, as today), reads that user's session cookie from `request.storageState()`, creates a new
browser context via the `browser` fixture (`browser.newContext({ baseURL, storageState: { cookies, origins: [] } })`),
opens a page, `goto("/dashboards")`, waits for the same "Add dashboard" shell signal `waitForShell` uses, runs the
unchanged `openPalette`, reads the labels, and closes the context. Expected cost: about 3.5-4.5 s per iteration on CI (each new context starts with a cold cache), so ~18-22 s per test.
- Alternative: `test.setTimeout` / `test.slow()`. Rejected: that is a bigger timeout, ruled out by the ticket.
- Alternative: register and log in once, then `page.reload()` 5 times. Rejected: the reloads share localStorage,
  sessionStorage and IndexedDB (HEL-1575's warm tab cache, HEL-1631's sessionStorage drafts), so boots 2-5 would
  not be independent of boot 1.
- Alternative: split into 5 separate tests. Viable, but it keeps the 3-load cost per boot (~30 s of CI per run), and
  it gives up the single-test framing the original comment explains.
- Alternative: keep `registerAndLogin` with `clearCookies` and drop only `waitForShell`. Rejected: the test needs a
  ready-shell signal before the shortcut (HEL-1030), and `/home` is not the route this test has always measured.

**D2. The ready-state wait stays the HEL-1030 shell signal** ("Add dashboard" visible on `/dashboards`). It is the
existing, always-present post-mount element the suite already uses; `openPalette` and its 10 s poll are untouched.

**D3. Independence is stronger than before, not weaker.** Previously the 5 boots shared one browser context (only
cookies were cleared), so origin storage carried over between boots. A new context per boot has empty storage.

**D4. Repro and proof harness (scratch-only, never committed).** CPU throttle is applied with CDP
`Emulation.setCPUThrottlingRate` through an uncommitted local patch, kept identical for the red run and the green
runs. It MUST throttle every page the test drives, including pages in the new per-iteration contexts. The harness
logs the applied rate per page, so a green result cannot come from unthrottled new contexts.

## Risks / Trade-offs

- [Cookie scope mismatch: the `request` cookie domain differs from the page's host] → the executor confirms that the
  new context's first `/api/auth/me` is 200 (it lands on `/dashboards`, not `/login`), and asserts the URL.
- [A real ordering regression is no longer caught] → mutation check: locally break the declared section order once,
  run the test, see it red, then revert.
- [Project `use` options not inherited by `browser.newContext`] → `playwright.config.ts` `use` sets `baseURL` (passed
  explicitly), `trace` and browser-wide `launchOptions`. The executor confirms that a failing run's retained trace includes the per-iteration
  contexts. If it does not, that is reported as a known gap.
- [Leaked contexts or users] → each context is closed in the same iteration (`try/finally`); users are recorded by
  `registerUser`, as before.

## Planner Notes

- Self-approved: test-only scope, `skip_specs: true`, AC rate. Red is shown at 2.5x (the rate that matches CI here;
  4x if 2.5x is not red within 40). Green is 40/40 at the same rate, plus a 4x 40-repeat run reported as headroom.
- Follow-up candidate (not filed here): `registerAndLogin({ waitForShell })` pays a `/home` load plus a `/dashboards`
  load suite-wide since HEL-1578.
