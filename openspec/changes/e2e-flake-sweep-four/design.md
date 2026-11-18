## Context

See proposal.md - Why. All six failing CI traces were downloaded during Planning to
`.concertino/scratch/HEL-1754/artifacts/` (raw zips) and unzipped to `.concertino/scratch/HEL-1754/traces/`
(main checkout, durable). `tools/dump_trace.py` there prints a trace's actions, logs, console and errors.

| Spec | Failing run / job (attempt 1) | Trace dir (under traces/) |
| -- | -- | -- |
| hel1578:111 | 44141488503 e2e (6); 44184688504 e2e (6) (PR #1146) | r44141488503-hel1578-..., r44184688504-hel1578-... |
| hel1668-schema-panel-copy:172 | 44074426286 e2e (2) (dark, opacity 0.997824); 44184688504 e2e (2) (light, select `rgba(0,0,0,0)`, menuImage `none`, opacity `0`) | r44074426286-hel1668-schema..., r44184688504-hel1668-schema... |
| hel1668-phone-sheet:184 | 44048058244 e2e (3) (PR #1139), first iteration (dark) | r44048058244-hel1668-phone-sheet... |
| hel813:93 | 44048058244 e2e (2) (PR #1139), 430 mono | r44048058244-hel813-mobile... |

## Goals / Non-Goals

**Goals:** a probe- or trace-backed root cause per spec; each forced red then 40/40 at 2 workers; a product defect, if
small, fixed with a failing-first test.

**Non-Goals:** retries, sleeps, longer timeouts; editing Popover/ActionsMenu CSS or positioning (HEL-1750 owns it --
if a fix needs it, stop and report); a suite-wide `waitUntil` sweep.

## Decisions

### D1. hel1578:111 is a product race in tab hydration (trace evidence, both failures identical)

Evidence: the spec does `page.goto("/home")` (cold load) and clicks the Dot A card ~2.3 s later. The click lands at
~17:57:54.97; the only panels fetch afterwards is for dashboard **B** (17:57:55.29), and the error-context shows the
tab strip "Dot B [selected]" with "Dot A, changed since you last viewed" unselected. `hydrateTabs`
(`frontend/src/features/dashboards/tabs/hydrateTabs.ts`) computes `plan` (target = saved active tab B, deep link read
from `window.location.pathname` = `/home` -> null) at the START, awaits `refreshChangeSignals` + the warm restore
(bounded 3 s), then unconditionally `dispatch(setSelectedDashboardId(plan.target))`. `DashboardRoute` had already
selected A in between; hydration overwrites it.

Fix (decided): after the await, re-read the deep link from the CURRENT location and re-run `planHydration` with the
fresh inputs; if the deep link changed since the start, the newly routed dashboard wins (a bare selection write is
not treated as a navigation, so non-user selection writes cannot hijack hydration) and becomes the selected dashboard and the active tab
(the re-run plan's target). No separate selection-compare path. Keep the pure `planHydration` testable; prefer re-running it with the fresh inputs over
ad-hoc branching. Unit test (jest, `hydrateTabs` thunk with a deferred `refreshChangeSignals`) fails first on main.
E2E red: in the spec (or a scratch copy) delay `/api/dashboard-changes` (route, hold until the click has happened --
an explicit gate, not a sleep) and show the heading never appears on main; green with the fix. The spec itself then
needs no change; if the executor adds a guard to the spec, it must not hide the product race.

### D2. hel813:93 is the window `load` event waiting on fonts.googleapis.com (trace evidence)

Evidence: `page.goto("/login")` (in `uiLogin`, `e2e/support/isolateLivePage.ts`) never reached `load` in 29.7 s; the
login form had rendered (error-context). Of 912 requests, exactly one never answered: the Google Fonts css2 stylesheet
(status -1). `app.html`/`index.html` load it non-render-blocking (`media="print"` + `onload`), but a stylesheet link
still delays the document `load` event. So any `goto`/`waitForURL` with the default `waitUntil: "load"` depends on a
third-party CDN.

Fix (test-side, the helper): `uiLogin` waits for what it uses -- `goto("/login", { waitUntil: "domcontentloaded" })`
(the `fill` already waits for `#email`), and `waitForURL("/home", ...)` likewise if its default `load` wait also
blocks (executor checks this; if it does, both calls change) followed by a real readiness assertion the callers rely
on. This removes the fonts dependency from the login navigation only -- not from any later `goto` a spec makes.

Forcing (decided, option (a) of design-gate round 1): stall ONLY the first fonts.googleapis.com request in the
browser context (a route handler that holds the first matching request forever and lets every later one continue
normally), matching the trace, where 1 of 912 requests went unanswered. Red: hel813 surface 1 on unmodified `uiLogin`
times out at `goto("/login")`. Green: same forcing with the fix passes. Residual risk, stated plainly: a stall that
persists past login (or lands on a spec's own later `goto`, e.g. hel813's `goto("/dashboards")` at :104) still
fails; that is recorded in the PR body as a named candidate and a follow-up suggestion (fixture-level fonts
treatment), not fixed here. Product alternative (inject the font link after `load`) rejected: it delays fonts for
every real user to fix a test. Executor greps the other specs' `goto` count and records it.
Executor also checks the known flakes hel1583-glass-nav:554 / hel1584:493 for this same shape where a failing run's
artifact is still available (`gh run list` for recent failures); fold in only if the evidence matches.

**Outcome (D2):** `uiLogin` now uses `waitUntil: "domcontentloaded"` on both `goto("/login")` and `waitForURL("/home")`.
Forced red on the first-fonts-request stall, green under the same stall, 40/40 at 2 workers. The residual risk above stands.

### D3. hel1668-phone-sheet:184 -- probe required; leading hypothesis: focus moved after the tap

Evidence: first (dark) iteration. The step sheet became visible at t=414653 ms; the `N fields` trigger tap was
performed at t=414765 (~110 ms later, during the `bottom-sheet-in` animation, `--motion-duration-move`) and Playwright
reported "tap action done". The snapshot after the tap is identical to before: `aria-expanded="false"`, no panel.
`OutputSchemaDisclosure` uses `usePortalPopover`, which closes on focus-out. Hypotheses, in order: (a) the sheet moves
focus (initial focus / a focus effect at animation end) after the tap, closing the popover via focus-out; (b) the tap
hit a different element (sheet still translating, `stable` passed on two frames); (c) the trigger re-mounted.
Probe: instrument (page-side listeners: focusin/focusout targets, the popover's open/close, the tap's
`elementFromPoint`) and tap at the same moment. Force: tap immediately once the sheet is attached. If (a) and the
product loses a real user's tap within the first ~300 ms, it is a product defect -> fix with a failing-first test (if
small); otherwise the test waits for the sheet's settled state (its open animation finished, via `getAnimations()`
finished promises, not a sleep) before tapping.

**Outcome (D3): not reproduced, stays a named candidate (AC4); no fix made.** Trace frames show the step sheet still
sliding up and the preview still loading (the trigger moved when it landed) at the tap. Probes that all passed: focus,
aria and mount listeners 20x; CPU throttle 6x/12x/25x/30x; the preview response released during the tap; the preview
delayed 150/250/350/450 ms. Hypotheses (a) late focus move and (c) trigger re-mount are refuted (focus moves to the
trigger on tap, one mount). (b) tap during motion is supported by the trace but could not be forced red. Unproven
hardening: wait for the sheet's animations to finish and "Loading preview" to clear before tapping the trigger.

### D4. hel1668-schema-panel-copy:172 -- probe required; two different symptoms

Evidence: failure 1 (dark): select tone and menu image correct (hover present), opacity `0.997824` -- a transition in
flight AFTER the spec's `getAnimations().finished` wait returned, i.e. a transition that started after the wait.
Failure 2 (light, second iteration): select `rgba(0,0,0,0)`, menuImage `none`, menuColor = canvas, opacity `0` --
neither `:hover` nor `:focus-within` held, and `.spine-row--selected .spine-row__menu`'s compact gradient did not apply
even though the row matched `.spine-row--selected` (check: which element `.spine-row--selected >> nth=0` resolved to;
is there more than one; did a re-render replace the row). In compact mode (`PipelineSpine.css`
`@container spine-column (max-width: 226px)`) the menu's opacity is 1 only on `:hover`/`:focus-within`; the spec's
tones depend on the sticky hover `realTap` leaves (tap + two `mouse.move`). Leading hypothesis: after the tap, the
selection re-renders/re-lays out the page (step editor mounts in the centre column, a deep-link navigation, a focus
move) so hover and/or focus leave the row, starting the 1 -> 0 transition (0.997824 is consistent with the first frame
of a fade-out). Probe: record hover/focus state and `getAnimations()` on the menu across frames after the tap; find
what changes. Force red by reproducing that change on demand. Fix per the cause (test waits for the settled
selection state the assertion is about; or product, if a tapped row really loses its tones for a user). Do NOT edit
Popover CSS; if the cause is there, report to the orchestrator (HEL-1750 coordination).

**Outcome (D4):** the re-render/hover-loss hypothesis is wrong. The pipeline opens with its first row already
`.spine-row--selected`, so `.spine-row--selected .first()` resolved to that pre-tap row 0 and the tones were read before
selection and hover reached the tapped row (per-frame probe: hover true at +71 ms, opacity 0.10 to 1 over ~150 ms;
0.997836 at +202 ms matches CI's 0.997824). Forced with 10x CPU throttle: original body red 10/10 (CI light signature),
fixed body (wait on the tapped row `.spine-row` nth(1): selected class, menu opacity 1) green 10/10, then 40/40.

### D5. Verification protocol (every spec, C12)

1) forced red on unfixed code, recorded with the exact command and output; 2) the fix; 3) the same forcing shows green
(where the forcing is a stall the fix tolerates) ; 4) `DEV_PORT=7186 BACKEND_PORT=10093 npx playwright test <spec> -g "<title>"
--repeat-each=40 --workers=2` (the run's pinned ports, never the 5173 fallback) -> 40/40, `nice -n 19`. Transcripts saved under `.concertino/scratch/HEL-1754/evidence/`. No
`waitForTimeout` added, no retries, no timeout raised.

## Risks / Trade-offs

- [D1 changes hydration semantics] -> limited to "a navigation after hydration started wins"; the no-navigation path
  is unchanged (scenario 2 in the spec delta); run the existing `hydrateTabs`/`dashboardTabsListeners` tests and the
  dashboard-tabs e2e specs.
- [D2 hides a slow-load regression] -> the specs never asserted page load time; readiness is asserted by the next
  locator wait.
- [D3/D4 may not reproduce locally] -> AC4: document probes tried, keep the named candidate; never invent a fix.
- [Shared dev DB] -> every user/dashboard a probe creates is cleaned by exact id before Delivery (C13).

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file or script invoked by `.husky/pre-commit` is touched.

## Planner Notes

- Self-approved: D1 is a small product fix (one thunk) in scope per AC3, not a split.
- Self-approved: D2 is test-side (shared helper); the product font loading stays as HEL-1678 left it.
- Artifacts are durable in the main checkout's scratch dir; the executor never needs to re-download.
