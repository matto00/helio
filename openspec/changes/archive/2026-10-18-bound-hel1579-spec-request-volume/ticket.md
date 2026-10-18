# HEL-1620: e2e hel1579 accent audit exceeds the per-user /api rate limit (123 requests in <60s, 22 × 429)

## Description

origin_kind: followup
origin_ticket: HEL-1613

Found by the HEL-1613 lane (2026-10-15/16) while sweeping layout specs. The hel1579 pipeline-page accent-audit e2e makes 123 `/api` requests in under 60s for one test user. Against the default `RATE_LIMIT_REQUESTS_PER_WINDOW` of 120 per 60s, 22 of them came back 429. Today it passes because the audited elements render before the rejected requests matter, so the failure is intermittent and timing-dependent. HEL-1575 hit the same trap (state-surface-contrast-guard) and had to cut its request volume.

**Fix:** find which requests the spec, or the page under test, repeats, and either cut the page's request volume, if that's a product defect, or restructure the test (fewer full reloads, or a fresh user per audit block). Do not raise the rate limit, and do not exempt test users.

**Added 2026-10-17 (from HEL-1628):** `e2e/hel1579-pipeline-spine-layout.spec.ts:174` also exceeds the 120/60s limit and fails on main (run 38954434243). HEL-1628 added one sample request per pipeline page load, which makes it slightly more likely. Cover both hel1579 specs in this ticket.

## Acceptance Criteria

- The spec's per-user `/api` request count is measured (before and after) and stays under 120 per 60s with margin (target: every test's worst 60s per-user window <= 90).
- Zero 429s across 10 runs of the spec.
- The rate limit is not raised and test users are not exempted.
- Root cause is probe-confirmed (red shown first: 429s observed or a per-user 60s window over 120) before any fix.

## Notes (orchestrator, premise validation)

- Only one hel1579 spec file exists: `e2e/hel1579-pipeline-spine-layout.spec.ts`. Both ticket paragraphs name the same test (`:174`, the accent audit). Every test in that file is in scope for measurement.
- Main CI run 39105908594 at 495bd7219 failed only on `:174` (`toBeVisible` on the "Rows after step" region, line 191), leg 3.
