## Standing Constraints

- [C1] Do not edit `playwright.config.ts`, `.github/workflows/ci.yml`, `e2e/hel1275-metric-delta-sparkline.spec.ts`, any product code, `focus-presence-guard.spec.ts` or `state-surface-contrast-guard.spec.ts` (the last two: audit only; raise an ESCALATION if affected).
- [C2] No assertion, expectation, count, timeout, `test.setTimeout`, retry or skip/quarantine change in any spec. The only permitted spec edits are page isolation, a reload-to-goto swap per design D2a, a listener attach-point move per D4, the throwaway-email log line, and imports.
- [C3] `about:blank` (`isolateLivePage`) is never followed by `page.reload()`, `page.evaluate` or a localStorage step before the next app-origin `goto`.
- [C4] Local Playwright runs: at most `--workers 2`, under `nice -n 19`, against this worktree's own servers (DEV_PORT=6732, BACKEND_PORT=9639), headless. Every user created by any run is recorded by exact email (and id by exact-email lookup). Nothing is deleted from the shared dev DB. Processes are killed only by the exact PIDs recorded.
- [C5] HEL-1298: evidence only. No contention-specific change. A direct causal link triggers an ESCALATION before any further change.
- [C6] Report any FirstRunRoutesSpec timeout or "Java heap space" seen in any gate or hook output.
- [C8] Do not edit `e2e/hel519-recent-navigation.spec.ts` or `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` (HEL-1298 owns them). Record their verdicts and the hel519 reload plan (isolate, then `goto("/")`) in inventory.md and the PR only.
- [C9] Affected tests in quarantined (`testIgnore`) or opt-in regression specs get the same mechanical fix and are labelled "verified by code reading only" in inventory.md and the PR.
- [C7] A test is `exposed-unobservable` only if, for each conditional `/` fetch (onboarding, sidebar section, palette), the inventory shows with file:line why its trigger is not met under that test's conditions. Otherwise it is `affected`.

## 1. Audit

- [x] 1.1 Enumerate the live `/` read set (every fetch, listener or effect that can run on `/` after login with no navigation) with its trigger condition: `App.tsx`, the route component, `SidebarBody.tsx`, `useOnboardingHost.ts`, `useResourceIndexing.ts`, listeners, telemetry, SSE. Record it with file:line in `inventory.md`. Verify: each entry cites a line and a condition.
- [x] 1.2 For all 38 UI-login files (list in design.md Context), classify every test per D1 (`not-exposed` / `exposed-unobservable` / `affected`) with a one-line reason and the line numbers of login, first seed and next load. Write the result to `inventory.md` as a table. For every `affected` test whose W contains or closes with a `reload()`, record the quoted purpose and the D2a-or-escalate decision. Verify: 38 files present; every test has a verdict; no `affected` test with a reload in W lacks that record; every `exposed-unobservable` row satisfies C7.
- [x] 1.3 Audit both guards (main and #774 head 9ee0f3e9: `gh pr diff 774`) per D7; record both verdicts. If either is affected, ESCALATION.
- [x] 1.4 Run the exposure probe (D6) on every `affected` test of the unmodified specs; add the observed/total counts to `inventory.md`. Record the throwaway emails from the traces/logs.

## 2. Helper and fixes

- [x] 2.1 Add `e2e/support/isolateLivePage.ts` (`isolateLivePage`, `loginThenIsolate`) with the D3 doc comment. Verify: lint, format and typecheck pass.
- [x] 2.2 Apply D2/D2a (and D4 where recorded) to every `affected` test; add the D5 email log line to each touched spec's registration (except the D5-exempt files hel1023, hel1028 and hel1260, whose emails come from their existing log lines). Verify: `git diff` shows no change matching C2's forbidden list (state the check used).
- [x] 2.3 For each touched file, record in `inventory.md` the fix applied and its reasoning; for the 7 #774-overlap files, confirm the hunks are disjoint from #774's.

## 3. Verification

- [x] 3.1 Post-fix isolation traces, taken on the modified specs with the D6 frame attribution (spot-checked on one trace): zero page-frame `/api/` requests between `about:blank` and the next goto for every fixed test.
- [x] 3.2 `nice -n 19 npx playwright test <touched specs> --repeat-each 10 --workers 2` against this worktree's servers; record per-file counts in `verification.md` and triage any failure.
- [x] 3.3 Record HEL-1298 (hel519:90, hel910:90) and HEL-1294 (hel958) findings with evidence (D8) in `inventory.md`.
- [x] 3.4 Record the residue: exact emails plus ids of every user created by every run, in `verification.md`.
- [x] 3.5 Lint, format check and typecheck; the commit passes the pre-commit hooks without `-n`.
