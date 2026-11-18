## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file (backend/.env, frontend/.env, infra/.env.deploy and similar), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Scripts may read scripts/concertino/.concertino.env, never print it.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill, pgrep or killall; kill only by exact PID; stop servers with stop-servers.sh; delete DB residue only by exact id via the guarded buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19; repeat runs capped at --workers=2.
- [C5] timeout 600000 on long calls; use sbt testFull (sbt can print TESTS FAILED and exit 0).
- [C6] If a budget is exhausted, escalate.
- [C7] Merge only through the auditor with gh pr merge --squash --match-head-commit; never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in the PR or commits.
- [C10] Phase 4 runs cleanup.sh --phase4 from the main checkout; confirm run.end; delete the local branch if cleanup skipped it.
- [C11] Known-flake rule: rerun only the failed job, once, and name it in the PR; a second failure escalates. Known flakes: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, plus this ticket's candidates.
- [C12] Every fix is proved red first with the forced-red recorded; no sleeps, no extra retries, no longer timeouts; every evaluator and skeptic runs the FULL affected spec files, not just new tests.
- [C13] Scratch goes in .concertino/scratch/HEL-1758/ (main checkout), never the shared session scratchpad.
- [C14] Clean up dev-DB residue by exact id.
- [C15] No Flyway migration and no model calls; do not touch HEL-1756's usePortalPopover/panelFit or HEL-1742's insight backend (report any overlap instead).
- [C16] Backend CI stays at ~4 matrix legs (owner ruling HEL-1287 C6, ci.yml:212-213): never add a leg; if 4 legs cannot meet the headroom budget, stop and escalate with measured numbers.

## 1. Backend compile-cache and dependency-cache keys (D1)

- [x] 1.1 Root cause: read the runner's hashFiles implementation and correlate the three 120 s failures (44226053854 b(1), 44244750573 b(3) att. 1, 44244673956 b(0)) with the preceding steps; write the most specific supported cause into `evidence/hashfiles-root-cause.md` (scratch)
- [x] 1.2 Add `scripts/ci-backend-cache-key.sh`: `git ls-files -s -- <pathspecs> | sha256sum` (never ls-tree with globs), 64-hex SHA-256 values, non-zero exit on an empty input set, `compile=`/`deps=` to `$GITHUB_OUTPUT`; prove each pathspec set equals the files today's hashFiles globs match (D1 (c))
- [x] 1.3 Add `scripts/ci-backend-cache-key.selftest.sh` covering every D1 (a) scenario; record red against both broken variants (ls-tree-with-globs, drop backend/project), then green; wire into an existing CI-only selftest step (not `.husky/**`); confirm check:precommit-ci-parity accepts it
- [x] 1.3a cache-janitor: add the old-vs-new `sbt-<64hex>` selftest case (mutation: a 40-hex key must fail it first), record
- [x] 1.4 Switch ci.yml:255/280/331/341 and `.github/actions/e2e-setup/action.yml:49` (own `backend-key` step inside the composite) to the backend job's `backend-key` step outputs and add a `backend-key` step to the security job for 395 (prefixes and restore-keys unchanged; checkout not sparse; HEAD is the commit under test); update the comments that describe the keys
- [ ] 1.5 (pending PR CI; commands in evidence/pending-pr-ci-measurements.md) After the PR's CI run(s) (including e2e-slow, triggered by the e2e-setup change): before/after table per backend leg with the key step's and Restore step's durations, the RESOLVED key string per consumer (4 backend legs deps+compile, security, >=1 e2e leg, e2e-prod-build, e2e-slow) matching the 64-hex patterns, deps/compile identical across jobs and equal to the local script output at the PR head, expected prefix-hit outcome (exact hit is post-merge only), + cache-hit/prefix-hit outcome + evidence the compile was incremental, in the PR body

## 2. Backend 660 s deadline (D2)

- [x] 2.1 Read `threads-6554.txt`/`threads-2658.txt`/`sbt.log` and record the hang-vs-under-provisioned verdict with the evidence; stop and report if it is a real hang
- [x] 2.2 Extend `gen-test-suite-weights.py` to a per-suite mean over `<run>=<dir>` groups with a script-written header (failing-first: today's last-one-wins output recorded); regenerate from >= 2 complete green main runs (exact artifact ids); list any suite still unweighted
- [x] 2.3 (model calibrated on 12 completed legs, max error 8.5 %; it does NOT reproduce the att. 1 straggler >= 498 s (predicts 342-363 s): see evidence/wall-time-model.txt; decided on nominal + stressed predictions, CI numbers pending) Wall-time model per D2 (groupWithinShard into 4 groups, LPT onto 2 slots), calibrated on 44223574075 leg 1 att. 1 (>= 498 s) and >= 2 completed legs, error stated; per-leg prediction table at 4 legs; budget = heaviest + 161 s <= 480 s; if unmet, STOP and escalate (C16), never add a leg
- [ ] 2.4 (local half done: sbt testFull green, 717 suites / 9802 tests, partition check x4 shards ok; CI half pending PR CI) Backend `sbt testFull` locally green (`-J-Xmx3g`, nice -n 19) and the shard partition check passes; after CI, per-leg "Compile and test" before/after table in the PR body

## 3. hel1665-home-phone-stability:437 (D3)

- [x] 3.1 Trace: font requests and their timing vs the measure; record whether any fonts request went unanswered (the HEL-1757 decision; default: not folded in)
- [ ] 3.2 (NOT DONE: not reproduced; no forcing matching the CI signature could be built; probes in evidence/e2e-root-causes.md; named candidate per round-4 fallback) Forced red on unfixed code with the CI signature (ch40 = the fallback width), recorded
- [ ] 3.3 (NOT DONE: no cause found, so no fix) Fix per cause; green under the same forcing; 40/40 at --workers=2 --retries=0; full spec file green

## 4. hel1583-home-375:25 (D4)

- [x] 4.1 Trace: what the measure waited on, and when the shelf data and cards arrived
- [x] 4.2 Forced red (route gate on the shelf data) with cardCount 0, recorded
- [x] 4.3 Fix per cause (stop and report if it is a product defect); green under forcing; 40/40; full spec file green

## 5. hel1573-motion-grid-chart:104 (D5)

- [x] 5.1 Trace and video: dashboard selected, panel/rows requests, chart mount state at the 5 s timeout
- [x] 5.2 Forced red per the cause found, recorded; or the full list of probes that failed to reproduce it
- [x] 5.3 (cause is timing only; a fix raises a timeout, a Non-goal; kept a named candidate) Fix per cause; green under forcing; 40/40; full spec file green (or keep it a named candidate per AC)

## 6. Wrap-up

- [x] 6.1 (diff lists only scripts/, .github/, package.json, backend/project, e2e/hel1583-home-375.spec.ts, openspec change; no HEL-1742/1756 file) Confirm no file touched by HEL-1742/HEL-1756 is in the diff (list the diff's files)
- [x] 6.2 Evidence transcripts under `.concertino/scratch/HEL-1758/evidence/`; summary of each candidate's outcome in `files-modified.md` handoff and the PR body
