## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f3fdef113858d79b5d69823cba18b68eb1a4dd8e`. The live base from `resolve-review-base.sh` was `469f4ea93`
(exit 0). The diff is 7 commits and 27 files. It is CI-only: no `frontend/**` change, so there is no UI or design
review.

### What I verified (with evidence)

**Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/sbt-thin-client-ci-hang/HEL-1339`.

**AC1: client-mode decision and startup cost (met).**
- Design D1/D1a chose the official runner's `--server`. All three sbt call sites use it:
  - backend and SBOM through `scripts/ci-sbt.sh`, which defaults to `--mode server`;
  - e2e through `scripts/e2e-backend.sh`, as `SERVER_FLAG="${E2E_SBT_SERVER_FLAG---server}"`. I checked in bash that
    this gives `--server` when the variable is unset and empty when it is set to empty. `ci.yml` never sets it.
- I pulled the HEAD run **37655563706** (pull_request on f3fdef113) myself. Every job succeeded.
  - SBOM log: `ci-sbt: mode=server pid=2330 exe=.../temurin-21-jdk-amd64/bin/java`.
  - backend(0) log: `mode=server pid=4792 exe=.../bin/java` and `ans: Long = 3221225472`, so the 3 GiB heap took
    effect. It shows `Tests: succeeded 1601, failed 0`.
  - e2e(4) log: `e2e-backend: mode=server pgid=2933 exe=.../bin/java` and `backend healthy after 50s`.
  - No log contains "BEEP WHIRR" or the thin-client line.
- I re-derived the job durations in `ci-evidence.md` from the jobs API across all 11 SERVER and THIN-AB attempts. The
  e2e legs over 420 s are exactly 441 (37579760599 a2 e2e4) and 423 (a3 e2e4) for SERVER, and 423 (37586488590 a4
  e2e1) for THIN-AB.
  - Per-run slowest-leg medians: SERVER 417, THIN-AB 412.
  - I re-pulled the 9 historical BASE runs: 36 legs, of which 3 are over 420 s (452, 439, 430). The median slowest leg
    is 411.

**Escalation accuracy (C2 ruling, not re-litigated).** The `escalation.raised` event
`HEL-1339-1791362731430-e6b288` told the owner:
- 2/28 legs over 420 s (441 and 423) for `--server`;
- 1/16 for the contemporaneous thin client and 3/36 for the historical thin client;
- slowest-leg medians 417 vs 412/411.

Every one of those numbers matches my independent API re-derivation. The evidence presented to the owner was accurate.
The `escalation.answered` event records `accept-server`, `answer_source: human`.

**AC2: thread dump from a recorded PID (met, and real on CI).**
- Run 37583797617 is on headSha `ef5873054`, the throwaway commit. Its security job (112669229970) is `failure`, and
  ci-complete is `failure`.
- I fetched that job's log from the API myself:
  - l.448–449: `mode=server pid=2564 exe=/usr/bin/bash`, then `exe=.../bin/java`.
  - l.526: `candidate pid=2564 source=launch -> thread dump via jcmd (722 lines)`.
  - l.529: the `::error::` naming the deadline and the artifact.
  - The step ran 06:51:45 to 06:52:47 (62 s, against a 120 s bound).
- I downloaded the artifact `sbt-diagnostics-security` (it has not expired) into scratch. All 5 committed files in
  `ci-logs/control-artifact/` are byte-identical to it (`cmp`).
- `threads-2564.txt` shows `"main"` in `Thread.sleep` <- `$Wrap...$sbtdef` <- `sbt.internal.Eval.getValue`.
- `ps-session.txt` shows PID 2564 = PGID = SID 2564 running `java ... sbt-launch.jar eval Thread.sleep(600000)`. So
  the recorded launch PID is the build JVM itself.
- On the AC's wording "PID recorded from the sbt server's own files": in `--server` mode there is no separate server,
  so the recorded launch PID and PGID play that role. The `active.json` socket-owner path covers thin-client mode. The
  design gate accepted this reading, and it meets the AC's intent of a recorded PID and no pattern match.

**AC3: osv `timeout-minutes` (met).**
- `ci.yml` gives `Install osv-scanner` and `Scan backend SBOM` each `timeout-minutes: 1`. curl has
  `-f --connect-timeout 15 --max-time 45`.
- In HEAD run 112910603004 both steps took 0–1 s. The `if:` chains (`!cancelled() && ...outcome == 'success'`) are
  unchanged.

**AC4: several CI runs, one at a time (met).** I listed the PR branch runs: 7 commits, each run completed before the
next was created. Failing-run logs are kept in `ci-logs/`.

**HEL-1287 / 1288 / 1296 still work (verified on the HEAD run 37655563706).**
- HEL-1287: four backend shards ran, and `backend-compile-v3-...` was an exact `Cache hit` (backend(0) log).
- HEL-1288: four e2e shards ran (`--shard=4/4`, 45 passed). The `wait` loop's fail-fast checks (dead group, before or
  after the fork; stage timeout) are unchanged apart from the two added lines (diff read in full).
- HEL-1296: the security step list on HEAD is SBOM, then SBOM positive control, osv install, osv scan and CVSS
  enforcement, all success.

**Timing inequalities (true).**
- SBOM: 75 + 25 + 5 grace + 1 = 106 s, under the 120 s bound. The control showed 60 s deadline -> 62 s step.
- Backend: 660 + 25 + 5 + 1 = 691 s, under the 780 s step bound.
- Backend job: I measured the job-start-to-"Compile and test" time across 13 attempts on this branch. The maximum is
  **66 s on shard 0**, because the selftest now runs there. 780 + 66 = 846 s, under 900 s. The inequality holds, but
  see the notes for the documented figure.
- Real headroom for the 660 s deadline: across 240 "Compile and test" legs in the last 60 CI runs, the maximum is
  309 s.
- Security job: the HEAD run took 57 s; the worst-case sums in `ci-evidence.md` (154–191 s) are under 300 s.

**Gates re-run by me, all exit 0:**
- `check:ci-sbt-guard` (4 files)
- `check:ci-sbt-guard:selftest`
- `selftest:ci-sbt` (all checks passed, real JDK/jcmd)
- `check:no-credential-leak` (8738 files, 0 violations)
- `check:precommit-ci-parity`
- `check:openspec`, `check:spec-structure`, `check:repo-integrity`, `check:test-temp-dir-hygiene`
- `prettier --check` on the changed files

**My own mutation reds:**
- Launching through a `| cat` pipe makes `selftest:ci-sbt` fail with 8 checks, including
  `(a) recorded PID's exe is java (not a tee/wrapper) -- /usr/bin/cat`.
- Appending `x=$(pkill -f sbt)` to `ci-sbt-diag.sh` makes `check:ci-sbt-guard` exit 1.
- The mutated run left two stand-in `java Hang.java` JVMs, PIDs 1255258 and 1260096. That is expected: the mutation
  breaks PID recording. I checked that their cwd was `/tmp/ci-sbt-selftest-EQJvqR/{backend,elsewhere}`, my own run's
  temp dir, then stopped those two PIDs by number. Nothing else was touched.

**ci-logs/ secrets: clean.**
- I grepped for gh*/github_pat, AKIA, sk-ant, re_, Bearer, PEM private keys and xox* tokens: 0 hits.
- `CONNECTOR_MASTER_KEY` values are elided (`<elided: CI-only test ...>`). The `_ID` is the public test label.
- The only long hex strings are git SHAs and cache-key hashes.
- I diffed the committed security log against my fresh API download. The only differences are 3 cache-key hashes
  replaced with `<hash-elided>`.
- The repo's own credential-leak gate passes.

**Throwaway residue: none in the net diff.**
- `git diff ef5873054^ c4cad37c3` is empty: the revert is exact.
- `grep -rn 'Thread.sleep|THROWAWAY|E2E_SBT_SERVER_FLAG' .github scripts` (selftest excluded) only hits the
  documented default line in `e2e-backend.sh`.
- `f710ca2e7` removed `--server` from `e2e-backend.sh` for the THIN-AB runs without saying so in its commit message.
  `7c380f213` restored it. Net clean, and the delivery squash erases both.

### Verdict: CONFIRM

### Non-blocking notes
- **Shard-0 pre-step figure.** The comment at `.github/workflows/ci.yml:214-215` and the backend line in
  `ci-evidence.md` give pre-steps as "25-40 s" and "max measured 31". On shard 0 the new selftest makes it **55–66 s**
  (measured, 13 attempts). The 900 s job inequality still holds with about 54 s margin before post-steps, but the
  stated input is wrong. Worth a one-word fix during delivery.
- **Spec wording vs evidence.** `specs/ci-sbt-invocation/spec.md` says the chosen mode "SHALL NOT push ... any e2e
  leg above 7 minutes", and 2 of the 28 measured `--server` legs exceeded 420 s. "Push" reads causally, and the
  evidence shows the excess is in the Playwright step on thin-client baselines too. Still, the canonical spec will
  carry an absolute-looking clause that the owner ruling relaxed. Consider rewording it to the D1/D1a startup gate
  before archive.
- **`kill -QUIT` fallback.** In `ci-sbt-diag.sh` the fallback sets `dumped=1`, so the error then reads "thread dump
  captured" when only a SIGQUIT was sent (the dump goes to `sbt.log`). That is accurate enough, but softer wording
  would be more honest.
- **Capture budget not strictly hard.** After the budget runs out, each further candidate still costs about 1 s
  (`kill -QUIT` + `sleep 1`). The margins absorb this: about 15 s on SBOM with 1 JVM, about 90 s on backend.
- **Repo size.** About 5.5 MB and 35k lines of CI logs will land in main via the archived change dir. The design (D7)
  and the driver constraint asked for this, but it is a lot of repo weight.
- **Unused paths.** The `active.json` socket-owner path and `--mode client` have no caller in CI now. They are
  harmless and documented.
- **Flaky tests.** The evaluator's spinoff suggestion stands: `OutputRoutesSpec.scala:756` and
  `ProductEventRollupServiceSpec.scala:85`.
