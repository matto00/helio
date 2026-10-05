# HEL-1289: Intermittent: owner repair POST never sent for orphaned text panel (hel1260-orphan-owner-repair e2e red on main)

## Description

Main CI on 1f955abd (the HEL-1272 merge) went red on the e2e job. `e2e/hel1260-orphan-owner-repair.spec.ts:37`, in the
**light** iteration, timed out on line 83: `expect.poll(() => repairPosts.length, { timeout: 15_000 }).toBe(1)` expected 1
and received 0. The grid had already rendered one `.react-grid-item`, so the dashboard loaded, but no
`POST /api/dashboards/:id/layout/repair` was sent within 15 seconds. The same spec passed on 32571b01 and on PR #770, so the
failure is intermittent. Seen three times on 2026-10-05: main 1f955abd, PR #772, and PR #774 run 37359043449, shard 3.

**Do not quarantine or loosen the test as the fix.** Find the cause first, with a probe-confirmed root cause
(systematic-debugging law). Is this test timing (the listener attached after the repair already fired, or the theme toggle
remounting the page), or a real race where the owner-open repair sometimes never fires?

Latest comment (a hypothesis from the HEL-1288 executor, unverified by the driver): after `registerAndLogin` the page stays on
`/`. It refetches `/api/dashboards`, auto-selects the API-seeded dashboard and fires `POST /layout/repair` (200), all before
the spec attaches `page.on("request")` and navigates, so the second load sends no POST. Candidate fixes: attach the listener
before login, or open the seeded dashboard from a fresh page or context. Also confirm that the auto-select repair on `/` is
intended behaviour.

## Acceptance Criteria

- Reproduce the failure: a loop of N runs of the spec under CI-like load, with the failure rate recorded.
- Name the root cause, with evidence from the trace or the reproduction.
- If it is a product race, fix the product and add a unit or RTL test that fails without the fix. If it is a test defect, fix
  the test and explain why the product is correct.
- Show N>=20 consecutive green runs of the spec after the fix.

## Driver / owner rulings (binding for this run)

- Do not quarantine the spec. Do not loosen the assertion as the fix.
- The fix must keep proving "exactly one repair POST, all breakpoints stored".
- N>=20 consecutive green runs locally (at most 2 workers), plus CI. At most one CI run at a time on this branch.
- Do NOT touch `playwright.config.ts` or `.github/workflows/ci.yml` (HEL-1288 owns them). A needed config change is an
  escalation.
- `hel958-join-step-editor` (HEL-1294) is out of scope.
- If the auto-select repair on `/` turns out to be a second product bug, escalate rather than widening scope.
