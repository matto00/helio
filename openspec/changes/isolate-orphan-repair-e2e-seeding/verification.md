# HEL-1289 verification

Servers: own ports DEV_PORT=6721 / BACKEND_PORT=9628. Raw output under /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/exec/.

## 1.5 Static gates (exit 0 each)
`npm run lint` (eslint --max-warnings=0), `npm run format:check` (all files Prettier-clean), `npm run typecheck` (tsc --noEmit): all clean.

## 2.4 Acceptance run: 20/20 consecutive green
`DEV_PORT=6721 nice -n 19 npx playwright test e2e/hel1260-orphan-owner-repair.spec.ts --repeat-each 20 --workers 2 --trace on --reporter=list --output /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/exec/run24`
Result: **80 passed (3.4m), exit 0**, 0 failed (4 tests x 20 repeats = 20 runs of the spec file). This was the first and only acceptance run, so no reds reset the count.

## 2.5 Trace parse (probe-check-isolation.py, ms units for both _monotonicTime and action startTime, per C1)
`python3 probe-check-isolation.py /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/exec/run24` -> **80 traces, 0 bad**. Per trace it asserts: exactly one about:blank goto and one dashboard goto; zero page-frame /api/ requests in [about:blank start, dashboard goto start]; orphan tests: exactly one page-frame repair POST over the whole trace, starting after the page's own GET /dashboards/<id>/panels following the dashboard goto (C1); UI-create tests: zero repair POSTs. All 40 orphan traces: one repair, status 200, +680..+850 ms after the dashboard goto (a genuine post-navigation load). Full output: /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/exec/parse24.txt.

## 2.1 Mutation (a): useStoredLayoutRepair inert (early return in its effect)
`... -g "owner open.*light" --workers 1` -> **RED**: poll toBe(1) Expected 1, Received 0 (spec line 87). Reverted with `git checkout`; `git status` afterwards shows only the spec and the change dir.

## 2.2 Mutation (b): extra dispatch of repairDashboardLayout
Same command -> **RED**: poll toBe(1) Expected 1, Received 2 (the count covers the whole page lifetime). Reverted with `git checkout`; git status clean of frontend changes.

## 2.3 Mutation (c): old spec (git HEAD copy, scratch file e2e/hel1289-scratch-old.spec.ts, deleted by exact path afterwards)
`... -g "owner open" --repeat-each 10 --workers 2` run twice (second with --trace on): **20/20 and 20/20 passed. The old ordering did NOT flake in this session** (the probe's 10/20 red was not reproduced; load was lighter). Trace parse of the second run ($E/mutC2-parse.txt): the repair POST was sent +33..+55 ms after the dashboard goto in 7/20 runs (sent by the old `/` page as it unloaded, counted only by luck of timing), 12/20 at +280..+880 ms, 1 at +5771 ms. So the old spec still only sometimes exercised the explicit open, which is the defect, but it did not go red here. I could not demonstrate mutation (c) red; the RED baseline is the orchestrator's probe (10/20, probe-root-cause.md).
