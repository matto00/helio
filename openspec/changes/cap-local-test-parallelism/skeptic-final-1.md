## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2c6ce28013e808701e17fcd79d75ffc6c26a4466`. The base was resolved live with `resolve-review-base.sh`: `b409172a53ebe6f80db154847cb1b85c286293e1` (exit 0). The spawn-cwd guard returned READY.

**Safety.** Everything I ran used `nice -n 19`, one job at a time. MemAvailable stayed at or above 25.8 GB throughout. I started no dev servers and killed no processes. I left the foreign `wt-base-2fb8deb5` sbt alone.

### What I verified (with evidence)

**AC1: every local entry point is capped at CI's numbers or lower, and CI is unchanged**

- **jest (root and frontend):** resolved config checked with `jest --showConfig`.
  - With `CI` unset: `maxWorkers` 3, `workerIdleMemoryLimit` 1500000000, and `cacheDirectory` set to `<checkout>/.jest-cache` (frontend: `frontend/.jest-cache`).
  - With `CI=true`: `maxWorkers` 11 and `/tmp/jest_rs`, the same as the base config.
  - With `HELIO_JEST_MAX_WORKERS=abc`: throws, and the error names the variable.
  - Independent identity proof: I loaded the base and HEAD config modules at their real paths and ran `assert.deepStrictEqual` on them. Under `CI=true` they are **identical** for both configs. With `CI` unset they differ only by the three added keys.
- **Playwright:** checked with `playwright test --list --reporter=json` and reading `config.workers`.
  - Local: 2. `CI=true`: 2. `HELIO_PLAYWRIGHT_WORKERS=1`: 1. `=abc`: throws and names the variable.
- **sbt forked JVM heap:** fresh `sbt --server -batch -J-Xmx3g` probes. No sbt server was up for this checkout (no `project/target/active.json`).
  - Locally, `show Test/javaOptions` and `show Compile/run/javaOptions` each gain `-Xmx3g`.
  - Under `CI=true` there is no `-Xmx`, and the `--add-opens` set is unchanged.
  - My first CI-run grep came back empty. Re-running showed the cause was ANSI colour codes in the output, not a missing value, so it was a measurement artefact, not a defect.
  - `build.sbt:214` shows that `Test/testGrouping` builds its `ForkOptions` from `(Test / javaOptions).value`, so the cap does reach the forked groups. Wrapping the env read in `Def.uncached` is what makes the value change in both directions; I saw it flip local→CI and CI→local.
- **Forked-group concurrency:** unchanged locally at 1 (serial), which is at or below CI's 2.
- **Node heap "where it matters" (D5a):** measured peaks are recorded for every non-jest hook process, all under 0.93 GB. Jest workers are bounded by `maxWorkers` plus `workerIdleMemoryLimit`, because jest has no CI-neutral `execArgv` mechanism. That reasoning is sound.
- **Prod untouched:** `git diff base...HEAD` over the paths below is empty (exit 0):
  - `Dockerfile`, `infra`, `.github`, `backend/src/main`
  - `frontend/vite.config.ts`, both `package.json` files, `backend/.sbtopts`, `.husky`, `scripts/concertino`
  - The Dockerfile runs `sbt assembly`. sbt-assembly 2.5.0 does not run tests and never reads `Test/` or `run/javaOptions`.

**AC2: the pre-commit path is capped.** The hook runs `npm test`, which is root `jest` followed by `npm --prefix frontend test`. Both configs spread `localJestCaps`. I ran `env -u CI nice -n 19 npm test` fresh and it exited 0:
- Root: 44 suites / 426 tests, including `PASS scripts/lib/jest-local-caps.test.js`.
- Frontend: 495 suites / 5168 tests in 67.0 s.

Prettier and eslint on the changed files: rc 0.

**AC3 and AC4: before/after measurements and wall-clock.** `measurements.md` §1–3 plus the raw CSVs and jsonl:
- Root jest: 12.4 GB → 4.3 GB.
- Frontend jest: 11.4–12.0 GB → 4.3–4.6 GB. The cost is +8–11 s from interleaved A/B pairs; I checked the `summary-all.jsonl` rows.
- testFull: 3.46 GB → 2.25 GB.
- Dev servers: 2.4 GB → 2.2 GB.
- The wall-clock cost is stated in CONTRIBUTING.md.

**AC5: docs and CON tickets.**
- CLAUDE.md and CONTRIBUTING.md have the caps table with CI values and the one-off overrides. MISTAKES.md records the incident with the measured numbers and the sbt 2 env-cache trap.
- CON-241, CON-242 and CON-243 exist in Linear (Backlog), with the titles that `measurements.md` gives.

**"3 lanes comfortably": my judgment is that it is met for the scenario that matters.**
- The incident scenario (three lanes committing at once) was measured **live**: three concurrent capped frontend `npm test` runs. Peaks were 4.98, 4.95 and 4.61 GB, all passed, and system MemAvailable never fell below **22.2 GB**, with other lanes' real load included. That is measurement, not extrapolation, and it is comfortable.
- The "~13.5 GB, tight" worst case assumes every lane is in the pre-commit hook, `testFull` and dev servers at the same moment. One lane's agents run sequentially, so a lane's hook and its `testFull` do not overlap.
  - The realistic per-lane peak is max(hook 5.0, testFull 2.3) + dev servers 2.2 ≈ 7.2 GB.
  - Three lanes: 21.6 + ~20 fixed ≈ 42 GB, leaving roughly 20 GB spare.
  - The RSS sums also double-count shared pages, so these figures are upper bounds.

**Iron Laws.**
- This ticket fixes no bug, so the regression-test rule does not apply. The new helper test does fail on any key added under CI: `toEqual({})`.
- The executor's EPIPE mis-measurement was disclosed and the affected runs re-run.

**UI.** No UI files changed, so step 4 does not apply. I did not start any servers.

### Verdict: CONFIRM

### Non-blocking notes

1. **sbt server JVM heap gap: acceptable to ship, but CON-241 is aimed at the wrong place. Needs an owner/driver decision, not a REFUTE.**
   - CONTRIBUTING.md's statement is correct for a developer's own shell: no tracked file can cap the server for `sbt testFull` typed by hand without reaching CI or Docker. `.jvmopts`/`.sbtopts` are read by CI's e2e `sbt run` job and by Docker's `COPY backend/ backend/`, and `build.sbt` cannot size its own host JVM.
   - However, `measurements.md` §2 ("None exists in tracked repo files ... the lane launcher (`.concertino.env`, a render target) -> CON follow-up") overstates this for **lanes**. The lane's sbt commands come from helio's own tracked `concertino.config.json`:
     - `devServers.backend.start`: `... sbt run`
     - gate `backend-test`: `cd backend && sbt testFull`
   - Nothing in `.github`, `Dockerfile` or `infra` reads that file, so adding `-J-Xmx3g` to both commands is a tracked, CI-neutral, prod-neutral way to cap lane servers. It only takes effect after a deliberate `concertino sync`, which C3 kept out of this lane's reach. It also needs a check that `-J` takes effect through sbt 2's thin client locally (`ci.yml` notes that it did locally but not on the runner).
   - Recommendation: retarget CON-241, or file a small HEL follow-up, to "edit `concertino.config.json` plus a deliberate sync". Shipping without it is fine: the gap predates this ticket, is disclosed, and was measured at ~1.0–1.5 GB RSS for the uncapped dev-server launcher.
2. **Undisclosed measurement condition.** Both `testFull` runs (base §1.3 and after) ran with the interim `-J-Xmx3g` on the sbt server (`measurements.md:78`; `evaluation-1.md:33`). Real lanes run `sbt testFull` with the server uncapped. So the 2.3 GB per-lane `testFull` figure in the 3-lane extrapolation table is a capped-server figure; the server could grow beyond it during test compilation under a 16.65 GB ceiling. This affects only the worst-case row, which is already labelled tight. A one-line caveat in that table would be accurate.
3. Minor items carried over from the evaluator:
   - "+17-20%" in `measurements.md` computes to 16-19% from the three pairs.
   - `toStrictEqual({})` would also catch an undefined-valued key.
   - `evaluation-2.md` is untracked in the worktree.
