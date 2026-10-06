# HEL-1294: Intermittent: hel958-join-step-editor e2e times out waiting for PATCH

## Description

origin_kind: followup
origin_ticket: HEL-958

On PR matto00/helio#772 (HEL-1256, which has no frontend or e2e change), the first e2e run failed `e2e/hel958-join-step-editor` on a 5s wait for a PATCH request. A rerun passed. The same run also hit the HEL-1289 flake.

**Do not quarantine or loosen the test as the fix.** Find the cause first, confirmed with a probe (systematic-debugging law). Is it test timing, such as a listener attached late or a 5s budget under CI load? Or is it a real case where the step-editor save sometimes never PATCHes, for example a debounce or a dirty-state race?

Coordinate with HEL-1288 (e2e CI time), which may change how parallel the e2e run is.

## Acceptance Criteria

- Reproduce under CI-like load and record the failure rate.
- Name the root cause, with evidence from the trace or the repro.
- If it is a product bug, fix the product and add a unit or RTL test that is red without the fix. If it is a test defect, fix the test and justify why the product is correct.
- N≥20 consecutive green runs after the fix.

## Driver rulings and constraints (this run)

- Owner rulings: do not quarantine the spec, do not loosen its assertions, and do not just lengthen a timeout.
- The fix must hold under HEL-1288's 4-leg × 2-worker sharding (branch `task/halve-e2e-ci-time/HEL-1288`, draft PR #774). Read its `playwright.config.ts` / `ci.yml` changes; do NOT edit `playwright.config.ts` or `ci.yml`.
- Do not fix other specs (HEL-1300 audits the HEL-1289 seed-while-/-live class; HEL-1298 tracks hel519:90 / hel910:90 contention-only failures).
- Local Playwright: at most 2 workers, under `nice -n 19`. Backend tests: `nice -n 19 sbt testFull`, Bash timeout 600000. At most one CI run at a time (HEL-1287 and HEL-1275 are also running).
- Never pick deletion targets by pattern/name/time window — only exact ids/paths/PIDs you created and recorded. Own headless browser context, own allocated ports.
- Record before/after failure rates.
