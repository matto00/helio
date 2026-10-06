## Standing Constraints

- [C1] Probe "full settled count" is defined independently of the helper (all section loaders gone + audit response), never by calling the helper; sort-button count (a) is the primary proof, a diverging population count (b) is recorded as a finding, never fixed by silently widening the helper.
- [C2] The deterministic-RED route delay stays below the default 5 s expect timeout.
- [C3] Probe source and all hel1336-probe-*/hel1336-repeat-* logs are persisted via persist-evidence.sh and their ref= paths cited in files-modified.md.

## 1. Setup

- [x] 1.1 Install root deps in the worktree with a project-local npm cache kept out of git; verify `npx playwright --version`
- [x] 1.2 Start servers via `scripts/concertino/start-servers.sh` on DEV_PORT 6768 / BACKEND_PORT 9675; verify /health
- [x] 1.3 Re-run the design.md inventory grep in the worktree; save raw output to scratchpad `hel1336-inventory.txt`


## 2. Helper

- [x] 2.1 Add `e2e/support/settingsReady.ts` (`waitForSettingsAuditTable`) per design D1/D2; verify `npm run check:e2e-types`
- [x] 2.2 Call it after each `page.goto("/settings")` in `e2e/hel813-mobile-touch-target-floor.spec.ts` (D4); verify diff shows no assertion/timeout change

## 3. Proof

- [x] 3.1 Scratch probe (D5) natural run ≥ 10 iterations; record at-heading vs settled counts in `hel1336-probe-*.log`
- [x] 3.2 Scratch probe delayed-route RED (0 sort buttons, lower population) and GREEN with helper; record logs
- [x] 3.3 Mutation: helper waits removed → delayed probe goes red; restore and re-confirm green
- [x] 3.4 `--repeat-each 10 --workers 2` under `nice -n 19` on the touched spec (D6); verify 0 failures, log kept

## 4. Hygiene

- [x] 4.1 Delete every probe/repeat-run user by exact id on the shared dev DB; record ids in `files-modified.md` evidence
- [x] 4.2 Lint/format/typecheck pass; commit only the helper, the spec edit, and the change dir
