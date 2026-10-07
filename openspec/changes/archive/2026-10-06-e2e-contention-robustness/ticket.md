# HEL-1298: e2e fragile under CPU contention: hel519-recent-navigation:90 and hel910-pipeline-to-dashboard-flow:90

## Description

origin_kind: followup
origin_ticket: HEL-1288

HEL-1288 found two specs that fail when the CI runner's CPU is contended (3–4 Playwright workers per leg on a 4-vCPU
runner), while staying green at 2 workers:

* `e2e/hel519-recent-navigation.spec.ts:90` (toBeVisible), red in run 37387266551 shard 3 and in the 4-worker run
  37384908643.
* `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:90`, red in run 37387266551 shard 4 and in 37384908643.

A test that passes only when the machine is idle is hiding either a timing assumption in the test or a real race in
the product.

(Line `:90` is the HEL-1288 branch numbering; that branch prepends 6 lines to hel519. On main the hel519 test is
"visiting a source from its list records it under Recent", line 84, failing assertion line 94. hel910's test is at
line 90 on both.)

## Acceptance Criteria

* For each spec, find a probe-confirmed root cause (systematic-debugging law). Reproduce it under CPU contention, for
  example 4 workers locally under `stress`/`nice` load, or a CI run at 3 workers per leg, and record the failure rate.
* Fix the real cause. Where it's a test defect, use web-first assertions or wait on the actual request or state, not
  a longer timeout. Where it's a product race, fix the product and add a unit or RTL test that is red without the fix.
* Do not quarantine either spec, and do not loosen its assertions.
* Show 20 or more consecutive green runs under the contended configuration.
* Coordinate with HEL-1288, which keeps CI at 2 workers per leg. This ticket is about robustness, not about raising
  workers.

## Driver constraints (binding for this run)

* Do not touch `playwright.config.ts` or `.github/workflows/ci.yml` (owned by HEL-1288, draft PR #774).
* Stay within the two specs plus any product code the root cause requires (HEL-1300 is editing other e2e specs).
* Both specs have the HEL-1289 shape (UI login lands on live `/`, then API seeding). Coordinate through the driver
  before editing the login/seed region of either spec.
* Locally: Playwright at most 2 workers under `nice -n 19`; contention via at most 3 niced background load processes,
  killed only by recorded PID. At most one CI run at a time.
* Record the exact id of every user/row created on the shared dev DB; never delete by pattern.
