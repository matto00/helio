## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 469f4ea9377729f90d32e640a22b61be3c487439 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **`--server` is the right flag for the runner CI actually uses.** Sighting logs show setup-sbt installs runner
  **2.0.9**, not 2.0.10 as design.md Context claims (`sec-37361823617-a1.log` l.181/241 `sbt-runner-version: 2.0.9`,
  cache key `Linux-X64-sbt-runner-2.0.9-1.5.3`; same in `e2e4-37416099275-a3.log` l.319/412). So the @v2.0.9
  script read is the correct one. In it: `--server) use_sbtn=0` (l.759); `isRunClient` returns false for sbt >= 2 only
  when `use_sbtn == "0"` (l.871-877); `-batch` only does `exec </dev/null` (l.765); `--client=false` is not a parsed flag;
  `SBT_NATIVE_CLIENT=true` can only set `use_sbtn=1` (l.958). Non-client path calls `run` -> `execRunner "$java_cmd" ...`
  -> `exec "$@"` (l.252, l.608). Claim CONFIRMED.
- **setsid -> exec chain.** util-linux `setsid` only forks when the caller is a process-group leader; a `&` child of a
  non-job-control bash (CI step shell, and e2e-backend.sh's subshell) is not, so it setsid()s and execs; the runner script
  then `exec java`. The recorded `$!` should be the JVM — IF `$!` is taken from a bare `setsid sbt ... &`. See CR3: the
  design's "tee'd" launch makes this ambiguous. D3's demand for empirical CI confirmation is correct and must stay.
- **Sightings.** Both logs show `entering thin client - BEEP WHIRR` / `starting sbt server in the background` /
  `set current project` then silence (sec l.430-437, 43.6 min to cancel; e2e l.993-999, 300 s). CONFIRMED.
- **Current ci.yml / e2e-backend.sh state** matches the design's Context (ci.yml l.202-215 backend, l.288-334 SBOM/osv,
  l.497-516 e2e; e2e-backend.sh `setsid $SBT run ... & echo $!`, `die` dumps log only). CONFIRMED.
- **Deadline vs timeout arithmetic** (gh API step timings, latest main run): backend pre-step setup 25-40 s, "Compile and
  test" 181-199 s; security setup->SBOM start ~47 s, SBOM 21 s, osv install/scan 0-1 s each. Job bounds 15 / 5 min.
- **Selftest wiring.** Selftests run in the `frontend` job (ci.yml l.51-128) and `.husky/pre-commit`; the `frontend` job
  has **no setup-java** (ci.yml l.21-40); `check-precommit-ci-parity.mjs` enforces hook/CI parity.

### Verdict: REFUTE

### Change Requests

1. **Static guard / selftest is not wired anywhere, and cannot run where the other selftests run.** Spec scenario
   "Static guard — WHEN the repository's checks run THEN they fail..." and D6 depend on `scripts/ci-sbt.selftest.mjs`
   being executed, but no task adds an npm script, a pre-commit line, or a CI step. The selftest needs a JDK (`java
   Hang.java`, `jcmd`) and the `frontend` job (where every existing selftest runs) has none. Decide and write into
   design.md + tasks.md: (a) the npm script name; (b) where it runs in CI (e.g. a step in the `security` or one `backend`
   leg that already has setup-java, or split the pure static grep guard into a JDK-free check that runs in `frontend`);
   (c) whether it goes in `.husky/pre-commit`, and that `check:precommit-ci-parity` passes either way. Without this the
   static-guard requirement is untestable as specified.
2. **The capture budget does not fit inside the step timeout in the wedged-JVM case the change exists for.** SBOM:
   deadline 90 s under a 120 s step timeout leaves 30 s, but D3 runs three `jcmd` calls (Thread.print, GC.heap_info,
   VM.flags) "bounded ~20 s" each, plus a `kill -QUIT` fallback, plus `ps`, plus TERM grace — worst case > 60 s, so the
   runner kills the step mid-capture and the `::error::` / stop never happen (spec: "capture happens before the runner
   kills the step"). Backend: 12 min deadline under 13 min gives 60 s, same problem. Specify one total diagnostics
   budget (e.g. Thread.print first with its own bound, remaining calls only if time remains, a hard overall cap), and
   record the inequality `deadline + capture_cap + grace < step timeout-minutes` per call site, and
   `pre-steps + step timeout <= job timeout` (security: setup ~47 s + 120 s SBOM + osv bounds + audits vs 300 s).
3. **`$!` source is ambiguous given "output tee'd".** D2 says sbt is started "under setsid in the background with output
   tee'd to the step log and `$RUNNER_TEMP/sbt-diagnostics/sbt.log`, records `$!`". A competent implementer could write
   `setsid sbt ... 2>&1 | tee f &`, where `$!` is **tee's** PID, or `> >(tee f)`, where bash may set `$!` to the process
   substitution. Pin the launch form in design.md (e.g. `setsid sbt ... >"$log" 2>&1 </dev/null & pid=$!` plus a
   separate `tail -f`/streaming of the log, or an equivalent that provably records sbt's PID), and add a selftest
   assertion that the recorded PID's `/proc/<pid>/exe` is the stand-in JVM (so a tee-PID regression goes red).
4. **Design and spec contradict on what happens after verification fails.** D2's sequence is dump -> TERM group -> KILL
   group -> exit 1, and D3 says "if not [verified], print why and skip" (skip the dump). The spec scenario "recorded PID is
   not a matching JVM" says "no signal is sent to it", and D6's wrong-cwd case expects "no dump, no signal". State
   explicitly whether the recorded PGID is still stopped when the PID fails verification (and why — PID-reuse safety vs.
   leaving a hung group to the step timeout/orphan cleanup), make D2, D3, the spec and the selftest say the same thing,
   and say how the selftest cleans up its own Hang JVM in that case.
5. **AC1 asks for the startup-time cost; the D1 gate measures whole-step medians, which are dominated by test noise.**
   Backend "Compile and test" varied 181-199 s across the four legs of one run; a >= 10 s median threshold over 3 runs
   cannot distinguish a real regression from noise in either direction. Add to D1 and task 1.1/4.4 a low-noise startup
   metric taken from log timestamps (step start -> "set current project to helio-backend", and -> first compile/test
   line) for each mode, record it per run, and make it part of the C2 gate alongside the existing medians and the
   5.5 / 7 min targets. Define the e2e "backend-ready time" as measured from `start`, not from `wait` (the `wait` line
   "backend healthy after Ns" counts from the wait step and hides startup cost that overlaps npm/Playwright install).
6. **The real-CI positive control can produce a false negative/false positive.** A forced 5 s SBOM deadline may fire
   while the runner is still in `jdk_version`/JVM boot, before the attach listener is usable, so `jcmd` fails and the
   control "proves" nothing — or dumps a JVM that never reached the build. Specify a control that hangs **inside the
   build** (e.g. a throwaway `"eval Thread.sleep(600000)"` command through the same helper with the normal deadline, or a
   deadline set after "set current project"), and require the evidence to show the dump contains the sleeping
   frame on sbt's main/command thread and that the dumped PID equals the recorded PID (this is also the D3 empirical
   confirmation).

### Non-blocking notes

- Correct design.md Context: CI runner is 2.0.9 (pinned via `sbt-runner-version: 2.0.9` in the action inputs shown in
  the log), not "action.yml default 2.0.10".
- e2e `die` after "running (fork)" (health timeout): the useful dump is the forked backend JVM, which is a member of the
  recorded group. Consider dumping every JVM in the recorded PGID (enumerated by recorded PGID/SID, never by name).
- `ps -g <n>` in procps selects by **session** id; it works here only because setsid makes SID == PGID. Say so, or use
  `--sid`, to avoid a reader "fixing" it.
- `curl --max-time` must be strictly below the osv step bound (with osv steps measuring 0-1 s, the bound will be the
  1-minute minimum), otherwise curl's own error never surfaces before the step kill.
- "Mode is visible in the log" for `--server` rests on the absence of a line; have the helper print a positive line
  (recorded PID, `/proc/<pid>/exe`, mode) so the mode is self-authenticating in every log.
