## Context

See proposal.md (Why). Grounding verified at Planning against the base branch (b409172a):

- `package.json` `test` = `jest && npm --prefix frontend test`; neither `jest.config.cjs` nor
  `frontend/jest.config.cjs` sets `maxWorkers`, `workerIdleMemoryLimit` or `cacheDirectory`. CI (`ci.yml:144`) runs
  the same `npm test` on ubuntu-latest; the repo is PUBLIC, so the runner is 4 vCPU / 16 GB and jest's default is 3.
- `playwright.config.ts:131` `workers: process.env.CI ? 2 : undefined`.
- `backend/build.sbt`: `Global / concurrentRestrictions` lifts sbt's forked-group limit only when
  `HEL924_TEST_GROUP_CONCURRENCY` is set (CI: 2, with `HEL924_TEST_GROUP_COUNT: 4`); unset = 8 groups run serially.
  `Test / javaOptions` and `Compile / run / javaOptions` carry only `--add-opens`, no `-Xmx`, so each forked JVM's max
  heap defaults to 1/4 physical RAM (~15.5 GB here, ~4 GB on CI). CI's `-Xmx3g` (`ci.yml:253-254`) bounds the sbt
  server JVM only. No tracked `.jvmopts`; `backend/.sbtopts` sets only the ivy home.
- Dockerfile copies `build.sbt` and runs `sbt assembly`; runtime is a plain `java ... -jar` ENTRYPOINT. Settings that
  only touch `Test`/`run` tasks cannot change the assembled jar or its runtime flags.
- Kernel log at the OOM: `shmem:13777920kB`. Planning observed `/tmp` is tmpfs (32 G) holding 17 G right now, of which
  `/tmp/jest_rs` (jest's default cache dir, `os.tmpdir()`) is 5.7 G and `/tmp/claude-1000` 9.9 G. tmpfs pages are
  shmem. This is a strong lead for the shmem source; it must be confirmed (not assumed) during Execution.

## Goals / Non-Goals

**Goals:** fixed, CI-or-lower caps on every local test/dev entry point, applied by config (not caller flags);
CI effective config byte-identical; prod untouched; measured proof that 3 lanes fit with headroom.

**Non-Goals:** changing CI's numbers; editing `scripts/concertino/*`; deleting anything already in `/tmp` or any cache;
capping the Claude Code harness's own `/tmp/claude-1000` (not this repo's to change — report it as a finding).

## Decisions

**D1 — Gate on `process.env.CI` / `sys.env.get("CI")` inside the config files.** Every caller (hook, lane, human)
inherits the cap without remembering a flag. With CI set, the code path must yield exactly today's config: for jest,
the local-only keys are *omitted* (spread a `localCaps` object only when CI is unset) rather than set to a value
equal to CI's default, so `jest --showConfig` is literally unchanged under `CI=true`. Alternative (flags in
`package.json` scripts) rejected: CI runs the same `npm test`, so a flag there changes CI too.

**D2 — Jest numbers.** `maxWorkers` local default ≤ 3 (CI's effective count); the exact number (2 or 3) is chosen by
measurement against the 3-lane budget and stated with evidence. `workerIdleMemoryLimit` set (value from measured
per-worker RSS). If Execution confirms `/tmp/jest_rs` growth is a material shmem contributor, set a local-only
`cacheDirectory` on disk inside the checkout (gitignored path, e.g. under `node_modules/.cache/jest`), not tmpfs.
Root and frontend configs both get it; helio-mcp's tests already run through the root config (verify).

**D3 — Playwright.** `workers: process.env.CI ? 2 : <local>` with local ≤ 2, overridable.

**D4 — sbt.** When `CI` is unset, append `-Xmx<local>` to `Test / javaOptions` and `Compile / run / javaOptions`
(value ≤ CI's effective ~4 GB, chosen by measuring the forked JVMs' real peak). Forked-group concurrency: leave the
local default at 1 (already ≤ CI's 2) unless measurement justifies 2 within budget; `HEL924_TEST_GROUP_CONCURRENCY` is
the documented one-off override (it predates D5 and silently ignores non-integers; documented as outside D5's
reject rule). With `CI` set the javaOptions must be identical to today (prove via `show Test/javaOptions` /
`show Compile/run/javaOptions` under `CI=true` before and after). **sbt 2.0.9 uses the sbtn thin client**: `sys.env`
is read in the *server* JVM, so every probe/measurement runs in a server started with the intended env (`--server` /
`--client=false` as `scripts/ci-sbt.sh` does, or confirm no server is up for that checkout) — constraint C7.
**sbt server heap rule:** if the measured local server max heap exceeds CI's 3g, cap it at or below 3g via a mechanism
CI and the Docker build do not read (never a tracked `.jvmopts`/`.sbtopts`), or report that none exists; if it is
≤ 3g (HEL-1273 suggests ~1 GB) record the no-op.

**D5 — Overrides.** One env var per cap (e.g. `HELIO_JEST_MAX_WORKERS`, `HELIO_PLAYWRIGHT_WORKERS`,
`HELIO_TEST_JVM_XMX`); CLI flags (`--maxWorkers`, `--workers`) still win as usual. An invalid override value is
**rejected** (the config throws with a message naming the variable and the accepted form) — never silently uncapped
and never silently defaulted.

**D5a — Node heap cap rule ("where it matters").** From the item-1 measurements of the full hook: any single node
process (jest parent, a jest worker, eslint, each `tsc --noEmit`, prettier, vite) whose measured peak RSS exceeds
1.5 GB gets a `--max-old-space-size` cap set at roughly 1.5× its measured peak, applied only when `CI` is unset and
through config the process already reads (jest: worker `execArgv`/`workerIdleMemoryLimit`; others: only if a
non-CI-reaching mechanism exists — `NODE_OPTIONS` in `package.json` scripts would also reach CI and is ruled out by
D1). For each process at or under the threshold, the evidence states its peak and that no cap is needed. A process
that needs a cap but has no CI-neutral mechanism is reported as a finding, not forced.

**D6 — Dev servers.** Vite and `sbt run` are started per lane by `scripts/concertino/start-servers.sh` (render
target). `sbt run` is capped via D4. Anything further there (e.g. a `NODE_OPTIONS` heap for vite, browser limits,
lane-brief guidance) is filed as a CON ticket, not edited here.

**D7 — Measurement protocol.** Everything under `nice -n 19`, one heavy job at a time, sampling total RSS by process
tree plus `/proc/meminfo` Shmem and `free` at ~1 s; abort if MemAvailable < 12 GB. Record the concurrent load of other
lanes (HEL-1393, HEL-1390) at measurement time and subtract/attribute it. Before = base config, after = new config,
for: the **whole `.husky/pre-commit` chain** (per-step peaks recorded, naming which step sets the peak — eslint, the
three `tsc` runs and prettier are separate node processes), full `sbt testFull`, dev servers idle. The 3-lane budget
includes resident sbt servers left behind by `testFull`/`sbt run` (sbtn servers outlive the command). 3-lane figure = live simulation only if single-lane
after-peaks × 3 leave ≥ 12 GB available; otherwise a stated extrapolation. Wall-clock before/after for `npm test` and
`sbt testFull`. Evidence written to the change dir (`measurements.md`) with raw sampler output paths.

## Risks / Trade-offs

- [Local hook gets slower] → stated in measurements and docs; override exists for a solo one-off run.
- [Heap cap too low → local OOM in a heavy suite] → value set from measured peak with margin; failure is a loud
  `OutOfMemoryError`, not silent.
- [CI drift] → before/after effective-config diff under `CI=true` is a required artefact.
- [Docker build evaluates build.sbt without CI set] → the changed keys are Test/run only; prove assembly flags and
  ENTRYPOINT unchanged.

## Planner Notes

- Self-approved: per-cap env overrides; leaving local sbt group concurrency at 1; jest cache relocation conditional on
  measurement.
- Driver assertions treated as claims: "two jest runs × 11 workers" is an inference to confirm or refute.
- Follow-up candidates (not in scope): `/tmp/claude-1000` growth in tmpfs (harness-side); start-servers.sh caps (CON).
- Concertino-side needs are handed to the orchestrator, which files each as a CON ticket and records the IDs in
  measurements.md and the PR body (the executor has no Linear write tool).
