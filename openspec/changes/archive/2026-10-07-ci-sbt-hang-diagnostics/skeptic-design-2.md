## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 469f4ea9377729f90d32e640a22b61be3c487439. The planning artifacts are untracked in the change dir.
I read ticket.md, proposal.md, design.md, tasks.md, both spec deltas, skeptic-design-1.md, premise-validation.md,
ci.yml, scripts/e2e-backend.sh, .husky/pre-commit, scripts/check-precommit-ci-parity.mjs, backend/build.sbt
(fork settings) and the official runner script @v2.0.9 (scratchpad `sbt.txt`).

### What I verified (with evidence)

- **Runner flag semantics (D1/D3 premise).** `sbt.txt` l.759: `--server) use_sbtn=0`. l.871-877: for sbt >= 2,
  `isRunClient` is false only when `use_sbtn == "0"`. l.765: `-batch` only runs `exec </dev/null`. l.604-608 and l.252:
  the non-client path is `execRunner "$java_cmd" ...` -> `exec "$@"`. So under
  `setsid "$SBT" ... & pid=$!` (a non-job-control bash, so the child is not a pgrp leader and setsid execs without
  forking), `$pid` becomes the build JVM. CONFIRMED. The design keeps the empirical CI confirmation (D6 control).
- **CR1 (wiring) is resolved.** `check-precommit-ci-parity.mjs` checks one direction only: hook scripts must be reachable
  from ci-complete's `needs` jobs (`checkPrecommitCiParity`, the "uncovered" loop). A CI-only script cannot fail it.
  `backend` and `frontend` are both in `needs: [frontend, backend, security, e2e]` (ci.yml l.570). D6/task 3.4 name
  the npm scripts and place them: the JDK selftest in backend shard 0 after setup-java (ci.yml l.169), the JDK-free
  guard in `frontend`. Neither goes in pre-commit. The design's D6 parity claim is accurate.
- **CR2 (capture budget) is resolved.** There is now one 25 s total cap, with Thread.print first and the extra calls
  only if >= 8 s remain. The inequalities are written down: SBOM 75+25+5 = 105 (+10 margin) <= 120 against the
  existing `timeout-minutes: 2` (ci.yml l.291); backend 660+30 = 690 < 780 against the new 13 min step and the
  15 min job (l.137). For the 5 min security job (l.250), the per-scenario sums are assigned to measurement in task 1.2,
  with an explicit shrink-or-escalate fallback. That is acceptable because the inputs (osv 0-1 s, SBOM ~21 s) are known
  and the job has plenty of headroom.
- **CR3 (`$!` ambiguity) is resolved.** D2 pins the launch form exactly: `>"$LOG" 2>&1 </dev/null & pid=$!`, with a
  separate `tail --pid` streamer. Selftest (a) asserts that the recorded PID's `/proc/pid/exe` was java, so a tee-PID
  regression turns red. The spec adds a "Recorded PID is the build JVM" scenario.
- **CR4 (contradiction) is resolved.** D2, D3, the spec scenario and selftest (c) now agree: an unverified PID gets no
  dump and no individual signal, the recorded group is still stopped, and the selftest cleans up through the group
  kill. I checked the D3 kernel argument against Linux pid lifetime. A `struct pid` (and its number) is freed only when
  no task is attached to it under any pid type, PGID and SID included. So while any member of the group lives, the
  number cannot be handed to a new process, and so cannot become a new PGID or SID. Joining the group needs
  `setpgid` from the same session, and that session is ours. The claim holds as stated. See the note below about the
  empty-group edge.
- **CR5 (noise) is resolved.** D1a adds log-timestamp startup metrics. For e2e, the metric runs from the start of the
  `Start backend` step to "backend healthy", explicitly not the `wait` step's own "after Ns". These metrics are part of
  the C2 gate, and tasks 1.1 and 4.5 record them.
- **CR6 (control validity) is resolved.** The control is now `"eval Thread.sleep(600000)"` through the helper, so the
  hang happens after "set current project". The evidence must show a `Thread.sleep` frame and that the dumped PID
  equals the recorded PID. A control that fires during JVM boot cannot pass this.
- **Round-1 notes absorbed.** The runner is corrected to 2.0.9. The design now enumerates every JVM in the group
  through `/proc/<p>/stat` (this covers the forked e2e backend and the forked test JVMs:
  build.sbt l.100-101 `Compile / run / fork`, `Test / fork`). It uses `ps --sid` with the reason stated, sets curl
  `--max-time 45` below the 60 s step, and prints a positive mode line.
- **AC coverage.** AC1 (decision plus startup cost) maps to D1/D1a and tasks 1.1/4.5. AC2 (dump from a recorded PID)
  maps to D2-D4 and tasks 2.x/4.1-4.4. AC3 (osv timeouts) maps to D5 and task 3.3. AC4 (several CI runs) maps to D7
  and task 4.5. The escalate-if-costly constraint is C2. No scope drift: the edits stay on the sbt lines, diagnostics
  and osv steps, as HEL-1341 requires. No API or schema is touched, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- **Dedupe candidates and clamp per-call timeouts to the remaining budget.** In `--server` mode the launch PID, the
  group enumeration and (if the JVM still writes `active.json`) the socket owner can all be the same PID. In a backend
  test hang, the group also holds the forked test JVMs. The design says "25 s total, checked against a start
  timestamp". The implementation should make each `timeout N jcmd` use min(N, remaining) and dump each PID once, or
  three 12 s calls overrun the cap. Backend has 90 s of margin; SBOM has 15 s.
- **Empty-group edge.** "If the group is already empty the kill is a harmless ESRCH" is true unless the PID number
  wraps and is reused by a new session leader between the group emptying and the kill. With CI's large `pid_max` and a
  window of seconds this is negligible, but the comment should not claim it is impossible.
- **AC2 wording.** The ticket asks for the PID "recorded from the sbt server's own files". In `--server` mode the design
  uses the PID recorded at launch, which is a stronger recorded source, and keeps `active.json` as a candidate when
  present. The intent ("not a pattern match") is met. The PR and `ci-evidence.md` should state which source each dump
  actually used, so the AC trace is explicit.
- **The backend job has no `setup-node`.** `npm run selftest:ci-sbt` in shard 0 will run on the runner image's default
  node. Keep the selftest to node built-ins (no `npm ci` dependency) or add setup-node. Include its measured cost in
  the shard-0 leg time compared against the 5.5 min target.
- **The static guard scans only the three scripts.** An inline `pkill` added to a ci.yml `run:` block would not be
  caught. Consider adding ci.yml's sbt and e2e steps to the guard's scan set.
- **e2e `die` does not stop the group.** This is correct today, because the runner reaps at job end. The spec line
  "nothing CI launched outlives the step" is written for the `ci-sbt.sh` path. Do not apply it to e2e, where the backend
  is meant to outlive `start`.
- **Spec wording on the osv download.** "Install osv-scanner fails at its declared timeout": with
  `curl --max-time 45`, curl's own error will normally fire first, at 45 s. Either outcome satisfies "well before the
  job timeout".
