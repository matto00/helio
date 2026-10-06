# HEL-1300: Audit e2e specs for the seed-while-/-is-live race (HEL-1289 class)

## Description

origin_kind: followup
origin_ticket: HEL-1289

HEL-1289 confirmed a test-ordering race. After a UI `registerAndLogin`, the page stays live on `/`: it fetches dashboards, auto-selects the most recent one, and runs that dashboard's effects. In the failing test, the stored-layout repair then fired while the spec was still seeding data through the API, before the spec attached its listener and navigated. The test went red 10 times in 20, even though the product sent exactly one repair every time.

The fix (`e2e/hel1260-orphan-owner-repair.spec.ts`, 2c49bdba) sends the page to `about:blank` after login and before seeding, and attaches request listeners before login.

About 33 e2e files carry their own `registerAndLogin` and may follow the same "login through the UI, then seed through the API while `/` is live" pattern.

## Acceptance Criteria

* Inventory every spec that seeds through the API after a UI login while the post-login page is live. Record for each one whether the live page can act on the seeded data, for example through auto-select, refetch or effects, before the spec's own navigation.
* Fix each affected spec the same way (`about:blank` before seeding, or seed before login) and give the reasoning for each.
* Do not change any assertion or timeout, and quarantine nothing.
* Consider a shared helper (for example `loginThenIsolate`) so new specs get this right by default.
* Note any overlap with the open flakes HEL-1294 (hel958) and HEL-1298 (hel519:90, hel910:90). If this race is their cause, link the evidence.
* Show a green CI run, plus `--repeat-each 10` locally (2 workers) over the touched specs.

## Driver constraints (run-level, from the dispatching driver)

* Do NOT touch `playwright.config.ts` or `.github/workflows/ci.yml` (HEL-1288, draft PR #774, 4 legs x 2 workers). Changed specs must stay correct under that sharding (per-file `mode: "parallel"`, no beforeAll/afterAll).
* Do NOT touch `e2e/hel1275-metric-delta-sparkline.spec.ts` (HEL-1275, PR #779).
* HEL-1298: record evidence only; do not fix it here unless evidence is direct, and then escalate before folding in.
* Local Playwright: at most 2 workers, `nice -n 19`, own ports, own headless context; `--repeat-each 10` over touched specs. At most one CI run at a time.
* Record the exact email/id of every test user/row created on the shared dev DB (HEL-1301 owns cleanup; no deletion here). Kill processes only by exact recorded PID. Never select deletion targets by pattern/name/time window.
* Report any FirstRunRoutesSpec timeout or "Java heap space".
