## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c957cb182f72838a7ce62e0d2c5925316ba06205` against live-resolved base `b409172a` (resolve-review-base.sh).
Spawn-cwd guard: READY. All gates and probes run by the evaluator under `nice -n 19`, one heavy job at a time,
MemAvailable never below 29 GB.

### Phase 1: Spec Review — FAIL

The implementation itself meets every acceptance criterion; the problem is in the measured evidence and the
incident write-up the AC asks for.

- AC "every local entry point capped at CI's numbers or lower; CI unchanged": PASS (independently verified, see Phase 2).
- AC "pre-commit `npm test` capped": PASS. Root and frontend jest both resolve `maxWorkers: 3` locally. helio-mcp has
  no jest config of its own and runs through the root config. All Playwright scripts go through `playwright.config.ts`.
- AC "nothing touches prod": PASS. `git diff b409172a...HEAD -- Dockerfile infra .github/ backend/src/main/resources/
  frontend/vite.config.ts package.json frontend/package.json backend/.sbtopts .husky scripts/concertino` is empty.
- AC "measured proof / 3-lane headroom / wall-clock cost": mostly PASS. The numbers in §2/§3 add up:
  3x(5.0+2.3+2.2)=28.5, +25 = 53.5; before 3x(12.4+3.5+2.4)=54.9; realistic 15+25=40. The 3-lane live peaks
  4,984/4,954/4,611 MB and min MemAvailable 22.2 GB match `summary-all.jsonl` (`lane1..3`). **But** the incident
  attribution in §1.1 contradicts its own cited raw source (CR1). The A/B wall-clock rows also come from non-zero-exit
  runs, and the report does not say so (CR3).
- AC "Documented in MISTAKES.md (the incident)": FAIL. MISTAKES.md repeats the wrong kernel-log figures (CR1).
- Tasks all marked done and match the diff. No scope creep: the `.gitignore`/`eslint.config.cjs` additions are needed
  by the new on-disk cache. CONSTRAINTS C1–C7 are honoured as far as the diff shows: no render-target, Dockerfile or
  prod-conf edits, and the CI-identity proofs exist.

### Phase 2: Code Review — PASS (gates green; findings are evidence/doc issues, listed under Phase 1 / CRs)

Gates (fresh evaluator runs, worktree, CI unset):
- `npm run lint`: rc 0. `npm run format:check`: rc 0.
- `npm test`: rc 0. Root 43 suites / 418 tests, frontend 495 suites / 5168 tests, 55 s wall (capped config).
- `npm --prefix frontend run build`: rc 0.
- `sbt --server -batch -J-Xmx3g testFull` (no sbt server was up for this checkout; the only other JVMs had cwd in
  other checkouts): rc 0, **6436 succeeded, 0 failed, 4 canceled**, 635 s. This shows the 3g forked-JVM heap carries
  the full suite.

Independent verification of the brief's items:
- (a) CI identity.
  - jest: my fresh `CI=true npx jest --showConfig --seed=1` for root and frontend at HEAD is byte-identical to the
    executor's `ci-proof/{root,frontend}.before2.json` (`diff` empty). I also loaded base `b409172a`'s
    `jest.config.cjs`/`frontend/jest.config.cjs` source under the same filename and compared raw config objects:
    `isDeepStrictEqual` is true under `CI=true`. Locally there are exactly 3 extra keys (`maxWorkers`,
    `workerIdleMemoryLimit`, `cacheDirectory`).
  - Playwright `--list --reporter=json`: `config.workers` is 2 under CI and 2 locally.
    `HELIO_PLAYWRIGHT_WORKERS=1` gives 1, `=abc` throws naming the variable, and `CI=true` with `=abc` gives 2
    (ignored, CI unchanged).
  - sbt: a fresh `sbt --server -batch` with `CI=true` (HEL924 vars unset) printed `show Test/javaOptions`,
    `show Compile/run/javaOptions` and `show Global/concurrentRestrictions`. After stripping ANSI codes and masking
    `Tags$Custom@hash`, the output is identical to `ci-proof/before.CI.plain.txt`. The 11 `Test/javaOptions`
    add-opens match base `build.sbt` literally.
- (b) Prod untouched: confirmed (empty diff above). `build.sbt` changes only `Test / javaOptions` and
  `Compile / run / javaOptions`.
- (c) `Def.uncached` works.
  - Successive fresh servers with different env gave `-Xmx3g` (unset), `-Xmx2g` (`HELIO_TEST_JVM_XMX=2g`), none
    (`CI=true`), and `[error] HELIO_TEST_JVM_XMX must look like 512m or 3g, got "lots"` (rc 1).
  - Real forked test JVMs during `testOnly` (cmdlines read from `/proc`, filtered by cwd = this backend): 3/3 carried
    `-Xmx3g` locally, `-Xmx2g` with the override, and no `-Xmx` with `CI=true`.
  - The dev-server `sbt run` forked JVM's argfile carries `-Xmx3g`. The launcher JVM is uncapped, as documented
    (CON-241).
- (d) `HELIO_JEST_MAX_WORKERS` = `abc`, `0`, `-1`, `1.5` and `" 2"` each throw naming the variable (root and frontend).
  `=2` gives 2. CLI `--maxWorkers=1` wins over the env var.

Code quality: small, readable, CI path omits keys (D1) rather than mirroring values, no dead code, no type escapes.
Non-blocking notes below.

### Phase 3: UI Review — PASS

Triggered by `frontend/jest.config.cjs` (test config only, no UI behaviour change).
- `start-servers.sh` + `assert-phase.sh servers`: PASS on 6874/9781.
- App loads to `/login` and renders the sign-in form.
- The only console errors are the two expected unauthenticated `401 /api/auth/me` probes. They are the existing
  logged-out path, not from this change.
- Breakpoint, a11y and empty-state checks are not applicable: no rendered UI changed.

### Overall: FAIL

### Change Requests

1. **Fix the kernel-log figures in `measurements.md` §1.1 and `MISTAKES.md`; they contradict the cited raw log.**
   - I parsed `measurements/raw/kernel-oom-0523.log` (the single 05:23:08 task table, 240 rows) with
     `\[\s*(\d+)\]\s+(\d+)\s+…\s+(-?\d+)\s+(.+)$`. That regex is robust to padded pids like `[  82059]` and to process
     names containing spaces.
   - Results:
     - `node`: **30** processes, **26.18 GiB** anon.
     - `java`: **6** processes, **6.50 GiB** anon (≈ 0.93/0.80/0.90/0.87/2.44/0.65 GiB; `rss_file` is 4 pages each).
     - `postgres`: 27 processes, 0.84 GiB `rss_shmem`.
     - Total anon over all rows: 42.2 GiB. Total `rss_shmem`: 1.07 GiB.
   - So these claims are wrong:
     - measurements.md table rows "node: 26 processes … 24.3 GiB" and "java: 2 processes, 3.1 GiB (the ticket's
       ~6.7 GB is the two JVMs' RSS incl. file pages; anon is 3.1)". The ticket's 6.7 GB is anon, across 6 JVMs.
     - "sum of rss_anon over every listed process 29.6 GiB", "postgres: 25 processes" and "0.85 GiB".
     - "The OOM table has exactly 26 node processes…".
     - MISTAKES.md "The kernel log shows exactly 26 node processes with 24.3 GiB anon" and "The two JVMs were
       3.1 GiB anon".
   - Required change: correct the numbers in both files. Restate the "two concurrent hook `npm test` runs" inference
     against 30 node processes / 26.2 GiB, and say it is an inference (the kernel table has no cmdlines). Restate the
     JVM contribution as 6 JVMs / 6.5 GiB.
   - "Jest, not the JVMs, was the memory" still holds (26 vs 6.5 GiB), and the shmem/tmpfs conclusion (13.1 GiB node
     shmem vs ~1.07 GiB mapped) is unaffected.
2. **Commit the cited raw kernel log.** `.gitignore:27` (`*.log`) excludes
   `measurements/raw/kernel-oom-0523.log`, so the source for the incident attribution is not in the commit and is lost
   when the worktree is removed. Rename it to `.txt` (and update the reference in measurements.md §1.1) or `git add -f`
   it.
3. **Disclose the non-zero exits of the A/B runs.** `summary-all.jsonl` has `rc: 1` for all six interleaved A/B runs
   (`fe-11-1..3`, `fe-default-1..3`), and measurements.md §1.2/§2 presents them as the frontend wall-clock evidence
   without saying jest failed.
   - Either state why they exited 1 and why that does not bias wall/RSS, or base the wall-clock claim on the passing
     runs.
   - The passing runs support the same conclusion: `fe-jest-uncapped` 40.7 s rc 0 vs `fe-jest-capped-warm` 48.7 s
     rc 0; root `root-jest-uncapped` 16.3 s vs capped 8.1/4.1 s, all rc 0.

### Non-blocking Suggestions

- `scripts/lib/jest-local-caps.cjs:15-17`: the comment says the 1.5 GB `workerIdleMemoryLimit` "bounds a leaking
  one". Measured healthy capped workers peak at 1.6–1.8 GB, so the limit also recycles healthy workers after a file.
  Reword it, or justify the value as deliberate recycling.
- `backend/build.sbt:31` comment says an invalid `HELIO_TEST_JVM_XMX` "fails the build load". It actually fails when
  `javaOptions` is evaluated (`show`, `testFull`, `run`); the build itself loads. Same wording in measurements is fine.
- Add a small jest test for `localJestCaps`: `{CI:"true"}` → `{}`; invalid override throws; `HELIO_JEST_MAX_WORKERS=2`
  → 2. The `env` parameter already makes it injectable, and it would keep a guard on the C4 CI-identity invariant after
  this PR.
- `CI=false` is treated as CI (truthy string) by `localJestCaps` and `build.sbt`, while jest's own `ci-info` treats it
  as not-CI. This matches Playwright's pre-existing `process.env.CI ?`, so it is consistent, but it leaves a
  `CI=false` shell uncapped. Consider documenting it.
- The 3-lane extrapolation's "fixed resident ~25 GB" (62 − 37) includes the other lanes' live load at measurement
  time. Adding 3 more lanes on top double-counts lane load, so the worst case is conservative. Saying so would make the
  "8 GB, tight" line read correctly against the owner's "comfortably" requirement.
