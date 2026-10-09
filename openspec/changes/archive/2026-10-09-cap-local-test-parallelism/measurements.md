# HEL-1442 measurements

All numbers measured on the dev box (Ryzen 5 7600X, 12 threads, 62 GiB; `MemTotal` 65,028,252 kB) on 2026-10-09 with
`measurements/sampler.py` (process-tree RSS + `/proc/meminfo` MemAvailable/Shmem at ~1 s; every job under
`nice -n 19`; one heavy job at a time except the labelled 3-run test; abort floor MemAvailable < 12 GB, never reached).
Raw sampler output: `measurements/raw/` (`summary-all.jsonl` = one JSON line per measured step, `*.csv` = 1 s series).
"Peak RSS" = peak of the SUM of VmRSS over the job's process tree (double counts pages shared between processes, so it
is an upper bound for anon use; the `peak_sum_anon_mb` field in the jsonl is the RssAnon sum).

**Concurrent load from other lanes** (HEL-1393, possibly HEL-1390, plus the desktop session): `MemAvailable` at the start
of each job was 31-39 GB (listed per job in `summary-all.jsonl` as `start_avail_gb`); load average 4-14 during the jest
runs. Their sbt/node processes were visible in `ps` but were never inside any sampled tree, so they are NOT in the
peaks below; they ARE why wall-clock figures are noisy (see the A/B table, which interleaves the runs).

## 1. Baseline (task 1.1-1.3)

### 1.1 Shmem attribution (the incident's ~14 GB)

Source: `journalctl -k` 05:23:08 (`measurements/raw/kernel-oom-0523.txt`, parsed from the OOM task table).

| quantity at the kill | value |
| --- | --- |
| `shmem` (node stats) | 13,777,920 kB = 13.1 GiB |
| sum of `rss_shmem` over EVERY row of the task table (240 rows) | 1.07 GiB (0.84 GiB of it postgres, 27 processes) |
| sum of `rss_anon` over every row | 42.2 GiB |
| `node`: 30 processes, `rss_anon` | 26.18 GiB, largest single process 1.66 GiB |
| `java`: 6 processes, `rss_anon` | 6.50 GiB (0.93/0.80/0.90/0.87/2.44/0.65 GiB; this is the ticket's "~6.7 GB") |

(Parsed with `\[\s*(\d+)\]\s+(\d+)\s+…\s+(-?\d+)\s+(.+)$`, which handles padded pids and process names containing
spaces; an earlier version of this section used a naive column split that dropped rows and understated node/java.
Source: `measurements/raw/kernel-oom-0523.txt`, committed; it holds only the kernel OOM task table, no credentials.)

So of the 13.1 GiB of shmem, ~12.0 GiB is NOT mapped by any process: it is tmpfs FILE data. Current state of the only
tmpfs mounts that hold data: `/dev/shm` 38 MB; `/tmp` (tmpfs, 32 G) 17 G used:

| `/tmp` entry | size | owner |
| --- | --- | --- |
| `claude-1000/` | 9.9 G | Claude Code harness scratch (per-session dirs, 3.8-6.0 G each); not this repo's to change |
| `jest_rs/` | 5.7 G | **jest's default `cacheDirectory` (`os.tmpdir()/jest_<user>`)**: 863 haste-map/transform-cache entries, one set per checkout/worktree (transform caches 50-130 MB each), never cleaned |
| `node-compile-cache/` | 0.8 G | node |
| `embedded-pg/`, `playwright-transform-cache-1000/`, other | ~0.1 G | test tooling |

`Shmem` in `/proc/meminfo` right now is 13.1-13.7 GB (the rest of the 17 G is swapped). Verdict: **confirmed, and
narrower than the planning lead** -- the incident's shmem was tmpfs `/tmp` content: ~5.7 G of it is helio's jest cache
(fixable here, and now moved to disk), ~9.9 G is the harness's scratch (reported, not changeable here). I cannot
reconstruct the exact split at 05:23 (the files were not enumerated then), only that the sum of all `/tmp` content
is of the right size. `sbt testFull` additionally raises Shmem transiently by ~1.3 GB (13.12 -> 14.42 GB; embedded
Postgres) and it is released at the end.

### 1.2 Whole `.husky/pre-commit` chain, base config (per step, sampled)

Run from the worktree with `npm run <step>` exactly as the hook lists them.

| step | wall s | peak RSS MB | largest single process MB |
| --- | --- | --- | --- |
| `lint` (eslint .) | 19.2 | 989 | 929 |
| `typecheck` (frontend tsc) | 8.1 | 996 | 868 |
| `format:check` (prettier) | 10.1 | 355 | 291 |
| `check:e2e-types` (tsc) | 2.0 | 371 | 308 |
| `check:helio-mcp-types` (tsc) | 2.0 | 415 | 288 |
| `check:no-credential-leak:selftest` | 119.3 | 389 | 219 |
| every other `check:*` step (22 of them) | 1-4 each | <= 258 | <= 92 |
| **`jest` (root, helio-mcp), uncapped = 11 workers** | 16.3 (cold /tmp cache) | **12,409** | 1,170 |
| **`npm --prefix frontend test`, uncapped = 11 workers** | 38.8 / 42.8 / 39.8 (3 interleaved runs) | **11,403 / 11,996 / 12,008** | 1,203-2,252 |

Non-test steps sum to ~190 s of wall; no non-jest node process exceeds 929 MB.
**The step that sets the peak is jest (root 12.4 GB, frontend 11.4-12.0 GB), by an order of magnitude.**

Worker scaling (frontend jest, base config, `--maxWorkers=N`): N=2 4.0 GB, N=3 5.0 GB, N=4 8.7 GB, N=6 7.8 GB, N=11 11.4-12.0 GB.
Each run is one parent + N workers: roughly 1.0-1.2 GB per worker plus ~1.5-2 GB for the parent and jsdom warm-up.

**"Two jest runs x 11 workers": consistent with the data (an inference; the kernel table carries no command lines).**
Uncapped jest defaults to cores-1 = 11 workers (`jest --showConfig` -> `"maxWorkers": 11`) and one run is 12 node
processes (13 with the `npm` wrapper) and ~11.4-12.4 GB in the sampler. The OOM table has 30 node processes with
26.18 GiB anon: two such runs (2 x 12-13 = 24-26 processes, ~23-25 GiB) plus a few other node processes (vite, tsc,
eslint) fit; I cannot prove from the kernel log that those were two hook runs. The JVMs add 6 processes / 6.5 GiB.

### 1.3 `sbt testFull`, base config (C7: `sbt --server -batch -J-Xmx3g "eval ...maxMemory; compile; testFull"`, no sbt server
was up for this checkout, `--server` = one foreground sbt JVM whose env is the invocation's)

| quantity | value |
| --- | --- |
| result | 6436 tests passed, 0 failed, 4 canceled; wall 580.7 s |
| peak process-tree RSS | 3,459 MB (sbt server + one forked test JVM; groups run serially locally) |
| largest process (the forked test JVM) | 2,397-2,455 MB RSS |
| forked test JVM max heap | **16,651,386,880 B (1/4 of RAM)**: `java -XX:+PrintFlagsFinal` MaxHeapSize; no `-Xmx` in `Test / javaOptions` |
| sbt server max heap, local, no flag | **16,651,386,880 B** (`eval java.lang.Runtime.getRuntime.maxMemory`); with the interim `-J-Xmx3g` 3,221,225,472 |
| shmem | +1.3 GB transient (embedded Postgres), back to baseline after |
| resident servers afterwards | none (`--server` is foreground). A plain `sbt run` (lane dev server) leaves the `sbt-launch.jar` JVM resident (see below) |

Dev servers idle, base config, started with `scripts/concertino/start-servers.sh` (`sbt run` + `npm run dev`):
sbt launcher JVM 970 MB + forked `run` JVM 566 MB + vite 766 MB + npm 61 MB = **2.4 GB per lane** (`raw/devservers-base.txt`).

## 2. After (tasks 5.1) -- caps as committed

| job | before | after | change |
| --- | --- | --- | --- |
| root jest | 12,409 MB, 11 workers, 16.3 s | 4,310 MB cold / 2,186 MB warm, 3 workers, 8.1 s cold / 4.1 s warm | -65% to -82% |
| frontend jest (3 interleaved A/B pairs, all rc 0, 5168 tests passed, load 8-21) | 11.5-11.8 GB, 11 workers, **48.2 / 49.3 / 56.5 s** | **4.3-4.6 GB, 3 workers, 57.0 / 57.1 / 67.4 s** | **-60% memory, +8-11 s wall (+17-20%)** |
| frontend jest, first run in a fresh checkout (new on-disk cache) | (cache was warm) | 83.2 s cold, 4,983 MB | cold-cache cost is the same as a new worktree's already was under `/tmp/jest_rs` (cache is keyed per rootDir) |
| `sbt testFull` | 3,459 MB peak, 580.7 s | **2,251 MB peak, 541.9 s**, 6436 passed | forked JVM heap now 3 GiB (see proof); wall within noise |
| dev servers idle | 2.4 GB | 2.2 GB (launcher 1,430 MB incl. startup, run JVM 498 MB with `-Xmx3g`, vite 265 MB + npm 64 MB at the sample) | `-Xmx3g` visible in the run JVM's argfile |
| other hook steps | unchanged | unchanged | no cap needed (D5a below) |

Whole hook chain, after, per commit: non-jest steps ~190 s unchanged + root jest ~4-8 s + frontend jest ~49 s.
**Wall-clock cost of the caps: +8-11 s on the frontend jest step** (interleaved pairs, load 8-21 from other lanes); the single
quiet-ish pair gave 40.7 s vs 48.7 s (+8 s). The full hook gets ~8-11 s slower.

**Correction:** the first set of six interleaved A/B runs recorded `rc 1`. Cause: my loop redirected `2>&1 >log | tail -0`, so
jest's stderr (where it prints results) went into a pipe closed at once by `tail -0`; jest died of EPIPE and its summary never
reached the log. Those six figures are discarded; the numbers above come from a re-run with correct redirection (all rc 0,
`Tests: 5168 passed`, `raw/ab2-*.csv`, `summary-all.jsonl`). The earlier single runs (`fe-jest-uncapped`, `fe-jest-capped-*`,
`root-jest-*`, `fe-jest-w*`) were all rc 0.

### D5a node heap rule (task 3.4)

Threshold 1.5 GB per process. Peaks (RSS): eslint 929 MB, frontend tsc 868 MB, prettier 291 MB, e2e tsc 308 MB,
helio-mcp tsc 288 MB, vite idle 766 MB (dev servers, not hook): **all under the threshold, no cap needed.** jest
workers: 1.2-2.25 GB RSS uncapped, 1.6-1.8 GB capped; one above the threshold. Jest has no config key for worker
`execArgv` (jest-worker inherits the parent's `process.execArgv`); the only other mechanism is `NODE_OPTIONS`, which
`package.json` scripts would also hand to CI (ruled out by D1). **Reported as a finding, not forced.** The bound that
IS applied is `maxWorkers: 3` (N workers x ~1.7 GB worst) plus `workerIdleMemoryLimit: 1.5GB` (a worker whose RSS is above it after a
test file is recycled; healthy workers peak at 1.6-1.8 GB, so this recycles some healthy workers too, deliberately, to keep
per-worker growth bounded; its cost is inside the wall-clock numbers above).

### sbt server heap rule (task 2.2 -- follow task 2.2)

Measured local sbt server max heap = 16.65 GB > 3 GB, so the rule says cap it, through a mechanism CI and the Docker build
do not read. **None exists in tracked repo files**: `backend/.sbtopts`/`.jvmopts` are read by CI/Docker (CI writes its own
`backend/.jvmopts`; `backend/.jvmopts` is gitignored, so a developer-local untracked file is fine but is per-checkout and
not automatic), and `build.sbt` cannot size the JVM it is being loaded in. Mechanisms that DO work, all outside tracked
files: `sbt -J-Xmx3g ...`, an exported `SBT_OPTS=-J-Xmx3g`, or an untracked `backend/.jvmopts` containing `-Xmx3g`. The
automatic route is the lane launcher (`CONCERTINO_BACKEND_START` in `scripts/concertino/.concertino.env`, a render
target) -> CON follow-up. Measured server footprint in practice: ~1.0-1.5 GB RSS, so the uncapped ceiling matters less
than the forked JVMs'. Documented in CONTRIBUTING.md.

## 3. Proof (tasks 2.1, 3.1, 3.2, 5.2, 5.3)

### Forked test JVM max heap (spec scenario "Local sbt testFull")
A temporary spec printing `Runtime.getRuntime.maxMemory` (deleted afterwards) under `sbt --server`:
- `CI` unset: 3,221,225,472 (= 3g)
- `HELIO_TEST_JVM_XMX=2g`: 2,147,483,648
- `CI=true`: 16,651,386,880 (unchanged default)
- `HELIO_TEST_JVM_XMX=lots`: `[error] HELIO_TEST_JVM_XMX must look like 512m or 3g, got "lots"`

### CI-identity (C4, byte-identical)
- **jest** (`raw/ci-proof/{root,frontend}.{before2,after2}.json`): the committed configs were swapped for HEAD's versions
  in place, `CI=true npx jest --showConfig --seed=1` captured, then the new configs restored and recaptured.
  `diff` empty, md5 equal (root `b8befc1f...`, frontend `c9eb8167...`), `cacheDirectory` included (`/tmp/jest_rs`, `maxWorkers` 11).
  Local differs only in `cacheDirectory` (`<checkout>/.jest-cache`), `maxWorkers` 3, `workerIdleMemoryLimit` 1500000000 (plus `ci`/`updateSnapshot`, which follow `CI`).
- **playwright** (`playwright test --list --reporter=json` -> `config.workers`): base `CI=true` 2, new `CI=true` 2;
  base local 6, new local 2, `HELIO_PLAYWRIGHT_WORKERS=1` -> 1, `=abc` -> throws naming the variable.
- **sbt** (C7: every probe a fresh `sbt --server -batch` JVM with the intended env; `raw/ci-proof/{before,after}.*.txt`):
  `show Test/javaOptions`, `show Compile/run/javaOptions`, `show Global/concurrentRestrictions` under `CI=true` (with and
  without `HEL924_TEST_GROUP_CONCURRENCY=2 HEL924_TEST_GROUP_COUNT=4`): before == after, `diff` empty (after masking the
  `Tags$Custom@hash` object ids). Local after adds exactly one `-Xmx3g` line to each javaOptions.
- **sbt 2 caching trap found while proving this** (MISTAKES.md): a plain `Test / javaOptions ++= Seq(.. ) ++ f(sys.env)`
  was served STALE from sbt 2's disk task cache (`cache 100%, N disk cache hits`): neither an `-Xmx` change nor an
  invalid override took effect, because the cache key does not include `sys.env`. `Def.uncached(...)` on the
  env-dependent part fixes it (verified: the values above).

### Prod untouched (task 5.3)
`git diff main...HEAD -- Dockerfile infra .github/workflows/cd-* 'backend/src/main/resources/application*.conf' frontend/vite.config.ts`
-> empty (re-run at commit time; see the executor report). `build.sbt` changes only `Test / javaOptions` and
`Compile / run / javaOptions` (neither is read by `assembly` or by the Dockerfile's `java -jar` ENTRYPOINT).

### 3 lanes (task 5.2)
Live and safe part: **three concurrent capped frontend `npm test` runs** (what three lanes committing at once do):
peaks 4,984 + 4,954 + 4,611 MB = ~14.5 GB, all passed, wall 74-76 s each, system MemAvailable minimum **22.2 GB**
(from 37.2 GB at the start, other lanes' load included) (`raw/3lane-*.csv`). The same three runs uncapped extrapolate
to 3 x 11.4-12.0 GB = 34-36 GB, which on top of the same ~25 GB of other resident use leaves ~2 GB: that is the incident.

All three lanes in their heaviest concurrent phases at once (hook + `sbt testFull` + dev servers + resident sbt launcher)
cannot be run live safely (3 x 9.5 GB = 28.5 GB leaves < 12 GB at the available 35-37 GB), so it is an extrapolation
from the measured single-lane peaks:

| per lane, after | RSS |
| --- | --- |
| pre-commit chain (peak step = frontend jest) | 5.0 GB |
| `sbt testFull` (server + forked JVM) | 2.3 GB |
| dev servers idle (launcher + run JVM + vite) | 2.2 GB |
| all three at once | 9.5 GB |

Fixed (non-lane) resident use. `62 - MemAvailable` at the start of a job (25-27 GB) INCLUDES the other lanes' live load at that
moment (two lanes with `sbt run` + vite servers, ~2.5 GB each idle, plus occasional work), so using it as the fixed term and
then adding 3 more lanes double counts. Derived instead: 25 GB minus ~5 GB for the two other lanes' idle servers = ~20 GB
for desktop session, system, and tmpfs Shmem (13.1 GB, of which 9.9 GB is the harness's `/tmp/claude-1000` scratch).

- Realistic (3 lanes committing at once): 3 x 5.0 = 15 GB + 20 = ~35 GB of 62 -> ~27 GB headroom (live: min available 22.2 GB with the other lanes' load included).
- Worst case (all three lanes in hook + `testFull` + dev servers simultaneously): 3 x 9.5 = 28.5 + 20 = ~48.5 GB -> ~13.5 GB headroom.
  **That only just clears the 12 GB abort floor; it is tight, not comfortable.** The owner's "3 lanes run comfortably" holds for the
  realistic case (three lanes committing, the incident scenario, ~27 GB spare) but not for the extreme all-phases-at-once case.
  Remaining levers if that matters: `HELIO_TEST_JVM_XMX`, the uncapped sbt server/launcher heap (CON-241), and the harness
  scratch in tmpfs (CON-243).
- Before the caps: realistic 3 x 12.4 = 37 + 20 = 57 GB (5 GB spare: the incident); worst 3 x (12.4+3.5+2.4) = 55 + 20 = 75 GB (does not fit).

## 4. Findings / CON follow-ups

Filed Concertino follow-ups:
- CON-241: `start-servers.sh` — cap the `sbt run` launcher JVM heap (vite heap optional).
- CON-242: lane-brief `nice`/caps guidance plus a cross-lane semaphore for heavy gates.
- CON-243: agent scratch on tmpfs `/tmp` — prune/relocate; also covers the one-time `/tmp/jest_rs` cleanup note.
- Worktree `.jest-cache` cleanup needs no ticket (deleting the worktree removes it).
