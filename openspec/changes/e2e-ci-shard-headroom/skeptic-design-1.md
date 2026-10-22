## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 26f6a1ede9b8b5f6c2b7144f9dc4d61698ea5a11 (the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/e2e-ci-shard-headroom/HEL-1698`.
- **Owner ruling (D1), verified and not re-litigated:** main checkout `.concertino/runs/HEL-1698/events.jsonl` line 6 has `escalation.raised` (options `six-legs,five-legs,five-legs-plus-login-cut,halt`, context names the ~8-leg prior cap). Line 7 has `escalation.answered` `answer:"six-legs"`, `answer_source:"human"`, same `escalation_id`, ts 1792636281868 = 2026-10-22 02:31 UTC. This matches the proposal and design text.
- **Measurement:** the scratch `measurement.md` before-table matches design.md's table row for row. The slowest legs (1292-1498 s) all miss the AC's 1200 s.
- **`plan 6` claim:** I ran `node scripts/e2e-shard.mjs plan 6` myself and got legs of 1383/1388/1386/1388/1383/1382 weighted s, which matches D2's "1382-1388".
- **D3 premise:** `scripts/e2e-shard.mjs:169` is `export const EXPECTED_SHARD_REPORTS = 4;`. `validateRunReports` defaults to it, and `findReports` calls it with no override (`:197`), so without D3 every future 6-leg run would be refused. The selftest pins 4 (`e2e-shard.selftest.mjs:145-149`). js-yaml is a root devDependency, and `check-ci-complete-needs.mjs:19` already imports it. The D3 premise holds.
- **D4 premise:** ci.yml `e2e`, ci.yml `e2e-prod-build` and `e2e-slow.yml` repeat the same setup steps verbatim, from checkout through backend wait. `e2e-prod-build` then diverges (build + `vite preview`), which `start-dev-frontend: "false"` handles. Services and env are job-level, and the design correctly keeps them in the jobs. `.github/actions/` does not exist yet.
- **D5 premise:** `scripts/check-e2e-slow-results.mjs` exports `evaluate`/`collectSkipped` and has exit 2 (no arg) and exit 1 (unreadable file / problems). It has no selftest. The RED cases listed in D5 map onto real branches of `evaluate()`.
- **Gate-chain / parity:** `check-precommit-ci-parity.mjs` is one-directional (hook to CI), so a CI-only new selftest in `frontend` does not trip it. `check:e2e-shard:selftest` is in `.husky/pre-commit:33`, and the design's checklist correctly says it applies if `e2e-shard.mjs`/its selftest change, which they do (task 2.5/3.1).
- **Spec deltas:** `openspec/specs/e2e-ci-sharding/spec.md` has no hard-coded leg count, so an ADDED-only delta is sufficient for the matrix change. The ADDED headroom requirement matches the ticket AC (5 consecutive all-green main runs, slowest leg at or under 20 min, timeout not raised).
- **Scope vs ticket:** the AC is covered by D1, with measurement post-merge. The three HEL-1667 extras (selftest, composite action, stale comment) are covered by D5/D4/D6. Options 1 and 3 are justified as rejected or owner-call. No placeholders or TBDs.

### Verdict: REFUTE

### Change Requests

1. **D4 drops CI sbt code out of the HEL-1339 pattern-kill guard's scope. Add the new action to it.**
   `scripts/check-ci-sbt-no-pattern-kill.mjs:12-17` scans exactly four files: `scripts/ci-sbt.sh`, `scripts/lib/ci-sbt-diag.sh`, `scripts/e2e-backend.sh` and `.github/workflows/ci.yml`. D4 moves the e2e jobs' sbt start/health/setup shell steps out of `ci.yml` into `.github/actions/e2e-setup/action.yml`, which the guard does not scan. The moved commands contain no pattern-kill today, but the composite becomes the single canonical home for e2e backend setup. A later `pkill`/`ps | grep` added there would pass `check:ci-sbt-guard` silently, a guard regression that this change creates. Revise D4 and tasks:
   - add `.github/actions/e2e-setup/action.yml` to `SCANNED`;
   - extend `check-ci-sbt-no-pattern-kill.selftest.mjs`'s "every SCANNED file is clean" coverage so it reads the new file;
   - add a task (in 3.3 or a new one) for mutation evidence: a `pkill` line in action.yml makes `check:ci-sbt-guard` fail, and reverting it makes the guard pass again;
   - add the file to the design's Impact list.
2. **D7 must state concretely how the existing `e2e-ci-sharding` "shard balance is measured in CI" SHALL is reported.** Changing 4 to 6 legs is "a change to e2e shard assignment", so that requirement applies. It asks for at least 5 sequential runs, per-leg median and max for both the whole leg and the test step, before and after, and the imbalance figure. D7 says only "before table above, after table from runs at hand" and "covered the same way HEL-1667 did". The before table above has whole-leg wall times only: no test-step medians and no imbalance. Revise D7 (and task 3.x / a delivery task) to say:
   - the before set (run ids, per-leg median and max for whole leg and test step, imbalance) is computed now from the 5 measured main runs;
   - the after set uses the same format and is filled from the 5 post-merge main runs the driver already watches for the AC;
   - the 15 s / same-window-control lines are reported with their measured values against the precedent (owner acceptance of HEL-1361, HEL-1667 design.md:56-57), not silently skipped. The same-window control is now unobtainable because count-based sharding no longer exists anywhere, so the design should say so.

### Non-blocking notes

- D5 says the new selftest uses "node:test, like `e2e-shard.selftest.mjs`". That file uses a hand-rolled `test()` over `node:assert/strict` (`e2e-shard.selftest.mjs:26-32`), not `node:test`. Either harness is fine; fix the wording so the executor isn't misled.
- `e2e-shard.mjs plan` still defaults to `rest[0] ?? 4` (`:288`) and the usage string says `plan <count>`. Consider defaulting it to the same constant as D3 so a bare `plan` shows the real CI plan.
- Expect queueing: about 16 jobs per run against a Free-plan cap of 20 means an overlapping PR run and main run will queue. That is owner-accepted. Leg wall is measured from `startedAt`, so the AC is unaffected. D7's per-leg queue-delay recording is the right visibility.
- `e2e-slow.yml` is edited in this PR (task 2.4), so its existing `paths` trigger already fires on this PR. Adding `.github/actions/e2e-setup/**` is still correct for future edits that touch only the action.
