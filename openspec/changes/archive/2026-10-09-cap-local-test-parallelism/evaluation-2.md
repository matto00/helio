## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed:** HEAD `2c6ce28013e808701e17fcd79d75ffc6c26a4466`. The new commit since cycle 1 is `2c6ce280`.
- **Base:** `b409172a`, resolved live.
- **Spawn-cwd guard:** READY.
- **How things were run:** everything under `nice -n 19`, one heavy job at a time.
- **Memory:** MemAvailable was 17.7 GB when I resumed. I stopped my own cycle-1 dev servers first, which brought it back to about 34 GB. The other lanes' load includes the driver's `wt-base-2fb8deb5` sbt JVMs, which I left untouched.

### Phase 1: Spec Review — PASS

Each cycle-1 change request was checked against the raw data, not taken from the executor's report.

- **CR1 (kernel-log figures): resolved.**
  - I re-parsed the now-tracked `measurements/raw/kernel-oom-0523.txt` with my own regex: 240 rows; node 30 processes / 26.18 GiB anon; java 6 / 6.50 GiB; postgres 27 / 0.84 GiB `rss_shmem`; total anon 42.23 GiB; total `rss_shmem` 1.07 GiB.
  - `measurements.md` §1.1/§1.2 and `MISTAKES.md` now state exactly these numbers. The "two hook runs" point is now labelled an inference.
  - The "~12.0 GiB of shmem is tmpfs" conclusion follows: 13.1 GiB of node shmem minus 1.07 GiB mapped by processes.
- **CR2 (raw log not committed): resolved.** `git ls-files` lists `kernel-oom-0523.txt`. It contains only the kernel OOM task table; a grep for credential-like strings finds nothing.
- **CR3 (A/B runs exited 1): resolved.**
  - The six re-run entries in `summary-all.jsonl` (`fe-11-1..3`, `fe-default-1..3`) are all rc 0.
  - Each run's wall time and peak RSS match its committed `raw/ab2-*.csv` series (last sample + 1 s; peak sums 11,544/11,814/11,590 and 4,307/4,579/4,398 MB).
  - The EPIPE cause is disclosed and the failed figures are discarded.
  - Table arithmetic: pairwise +7.8 / +10.9 / +8.8 s, so "+8-11 s" holds. Memory is about −62%.
- **3-lane headroom.** The double-counting is now removed: the 25 GB "62 − available" figure minus about 5 GB of other lanes' idle servers gives about 20 GB fixed.
  - Realistic case: 15 + 20 = 35 GB, about 27 GB spare.
  - Worst case: 28.5 + 20 = 48.5 GB, about 13.5 GB spare.
  - The doc honestly says the worst case is tight and that "comfortable" holds for the realistic (incident) scenario. Follow-up levers are named: CON-241, CON-243, `HELIO_TEST_JVM_XMX`.
- **Rest of Phase 1.** All acceptance criteria are still met. Tasks match the diff. CONSTRAINTS C1–C7 are honoured. The diff is empty for the protected paths: Dockerfile, `infra/`, `.github/`, `backend/src/main/resources/`, `vite.config.ts`, both `package.json` files, `.sbtopts`, `.husky`, `scripts/concertino`.

### Phase 2: Code Review — PASS

**Gates I re-ran fresh at `2c6ce280`:**
- `npm run lint`: rc 0.
- `npm run format:check`: clean.
- `npm test`: rc 0. Root 44 suites / 426 tests (up 1 suite / 8 tests: the new `scripts/lib/jest-local-caps.test.js`). Frontend 495 suites / 5168 tests.
- The new test passes with `CI` unset and with `CI=true`; it injects its own env, so it is CI-neutral.

**Not re-run, and why that is acceptable:**
- `npm --prefix frontend run build` and `sbt testFull` were not re-run at this commit.
- The diff since `c957cb18` (where I ran both green in cycle 1: build rc 0; testFull 6436 passed, 0 failed) touches no `frontend/`, `playwright.config.ts` or jest config files.
- Its only `backend/build.sbt` change is one `//` comment line.
- I confirmed the build still loads and behaves the same with two fresh `sbt --server -batch` runs (no sbt server was up for this checkout). `show Test/javaOptions` gives `-Xmx3g` locally. With `CI=true`, `Test/javaOptions` and `Compile/run/javaOptions` show no `-Xmx`.

**Code changes since cycle 1:**
- The new test asserts `toEqual({})` under CI. That fails for any real key/value a regression would add; it only ignores `undefined`-valued keys, which jest also treats as unset.
- It also covers the local caps, the override, and five invalid override values.
- The comments in `jest-local-caps.cjs` and `build.sbt` are now accurate. The `CI=false`-counts-as-CI semantics are documented in CONTRIBUTING.md and the helper.

### Phase 3: UI Review — PASS

This cycle changed no UI-affecting files. The cycle-1 result stands: the app loaded `/login` through the canonical servers, and the only console errors were the expected logged-out 401s. Those dev servers (6874/9781) are now stopped, using the PIDs I recorded (sbt launcher 1517860, run JVM 1518447, vite 1518886, its npm parent 1518868). Both ports now return 000.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- In CONTRIBUTING.md, "(the frontend jest step: ~40 s -> ~49 s measured)" next to "8-11 s" now cites only the quiet pair. Consider citing the interleaved range too.
- In measurements.md, "+17-20%" computes to 16-19% from the three pairs (7.8/49.3, 10.9/56.5, 8.8/48.2).
- `jest-local-caps.test.js` could use `toStrictEqual({})` so even an `undefined`-valued key added under CI would fail.
