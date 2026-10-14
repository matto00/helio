## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 3bee1b9d76a618ffad468f8b941ac55ad2834745 (base e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90, resolved live).
Diff: MISTAKES.md plus the change directory (planning artifacts, investigation/, 37 transcripts). No backend/ or
frontend/ file changed, and no build file changed.

### Phase 1: Spec Review — FAIL

Verified against the transcripts and the surviving scratch logs (`.../scratchpad/HEL-1595/logs`, `scripts/race.sh`):

- AC1 (two-tree repro, cache location and keys): PASS. 1.1-cachedir-A/B show `-Dsbt.global.localcache` relocating
  `Global/localCacheDirectory` to the scratch `cache/v2` for both trees. cache.md's key/content claims hold. I
  re-sampled 3000 of 42326 `~/.cache/sbt/v2/ac` entries read-only and found 0 with `worktrees` or `/home/matt`. Each
  entry is `${OUT}`-relative JSON with no log text.
- Spec scenario 1 (A fails after B green): PASS. 1.2-B-testFull is EXIT 0 with 8083 tests. 1.3-B-probe-green is
  EXIT 0. 1.3-A-testFull-red is EXIT 1 with `succeeded 8083, failed 1`, names A's paths, and still prints `cache 100%,
  644 disk cache hits`.
- Spec scenario 2 (live foreign server, bare / -batch): PASS. 3.2-a and 3.2-b name A, the probe fails and both
  exit 1. 3.1-B-procs records B's shell-mode JVM. 3.0-B-sbt-shell-server shows that server accepting a client.
- Spec scenario 3 (`--client`): PASS. 3.2-c prints `starting sbt server in the background`, so it did not attach to
  B. It names A and exits 1. No `active.json` remains in A's `backend/project/target`, so that server was shut down.
- Spec scenario 4 (concurrent, N=5): PASS. In race.sh and 4.1-4.5.summary, A started 3 s after B's log showed
  `set current project`/`compiling`. In 5 of 5 repeats A printed `MARKER=marker-A-n` and exited 1, and B printed
  `marker-B-n` and exited 0, with 0 foreign-path lines.
- Spec scenario 5 / AC4 (lane check): PASS on mechanics. I ran the four greps on the real logs. They pass the
  final A testFull (49 own-path hits, 8083 run, 615 suites) and give 0 own-path hits on a tree-B log.
- AC3 (what the skeptic saw): the explanation is labelled INFERENCE in README.md and "Not verified" in MISTAKES.md.
  forensics.md matches the windows it cites.
- C1/C2/C4: honoured. Tree B and the scratch cache are gone, and only the pid files, logs and scripts remain. No
  recorded PID is alive. A's `backend/target` and `project/target` were born at 06:37:36, after the last race
  repeat (06:34) and before 4.2. `git status` is clean, and no `Hel1595*` source remains.
- C3: `.env` was not copied (3.0-B-sbt-run fails on "no PostgreSQL user name"), and the JVM was recorded as alive.
  The socket/`active.json` observation is not in any transcript (see suggestions).
- Tasks 2.x marked N/A with a reason, which is correct since nothing reproduced. CLAUDE.md is unchanged, and its
  note is still accurate.

**Issue (spec-divergence, labelling): step 3's `sbt run` B-server model was not exercised, and MISTAKES.md does not
say so.** forensics.md identifies a live detached `sbt run` in HEL-1451 as the foreign JVM during the bad window.
design.md D2 step 3 makes that the default B model. 3.0-B-sbt-run shows B's `sbt run` died about 2 s after boot
(Flyway, no `.env`), and the attach test was then run against a shell-mode JVM instead. README.md:24-28 records the
substitution. However:
- MISTAKES.md:328 states "A command-mode `sbt run` / `sbt "<cmd>"` starts no server at all" as a verified fact. A
  live `sbt run` was never observed. The claim is extrapolated from `sbt 'eval Thread.sleep(45000)'`, and even that
  observation (no `active.json`) is not in 3.0-B-sbt-sleep-default.txt, which holds only sbt stdout.
- MISTAKES.md:375 "Not tested:" and README.md:42 "Untested conditions" both leave out the one condition forensics
  says actually happened: a live detached `sbt run` backend in the other tree.

design.md's risk mitigation requires the MISTAKES entry to name "any untested condition explicitly", so this is a
divergence from the agreed design.

### Phase 2: Code Review — PASS

- No code changed. The gates mapped to `frontend/**`/`backend/**` are not triggered, so sbt was not re-run. The final
  A `testFull` evidence was checked from the transcript and the full scratch log instead.
- Cheap doc gates I ran in the worktree: `format:check` (0), `check:openspec` (0), `check:spec-structure` (0),
  `check:repo-integrity` (0) and `check:no-credential-leak` (0, 11855 files scanned). The transcripts contain no env
  maps and no `.env` content.
- The MISTAKES.md formatting and wording are consistent with the surrounding entries.

### Phase 3: UI Review — N/A

Build infrastructure only, with no UI triggers touched. Skipped per the orchestrator's instruction.

### Overall: FAIL

### Change Requests

1. MISTAKES.md:328: relabel the `sbt run` sentence as inference with its basis. For example: "A command-mode
   `sbt "<cmd>"` (observed: `sbt 'eval Thread.sleep(45000)'`) started no server (no `project/target/active.json`).
   A live command-mode `sbt run` is expected to behave the same but was not observed, because tree B's `sbt run`
   exited at boot without `.env`."
2. MISTAKES.md:375-376 ("Not tested:" list): add "a live detached `sbt run` backend in the other tree, which is what
   HEL-1451 was running in the window (B's `sbt run` failed at boot without `.env`, so the foreign server was
   modelled with a shell-mode sbt JVM)".
3. investigation/README.md:42 ("Untested conditions"): add the same condition. At README.md:24, mark the
   `sbt run`-starts-no-server claim as inferred from the eval-sleep run, and say which record holds the
   `active.json` observation. If no record does, label it as observed but not captured.

These changes are documentation only. No sbt re-run is needed, and the verdict does not depend on making `sbt run`
boot.

### Non-blocking Suggestions

- C3 asked for a record of B's server socket. 3.1-B-procs records the processes, and the shell-server transcript
  shows a client connecting, but no transcript captures `active.json` or the socket path, or A's socket hash differing
  from B's (MISTAKES.md:326-327). If those values are still known, add them to 3.1-B-procs.txt.
- The 1.x/3.x transcripts do not record the command lines that were invoked. For example, nothing in
  1.3-A-testFull-red.txt shows that `-Dsbt.global.localcache` was passed. race.sh does record its commands. A
  one-line `$ cmd` header per transcript would make the evidence self-authenticating.
- D2 step 4 asked for target/out symlink provenance. The executed `MARKER=marker-A-n` line is stronger evidence for
  the same question, but README should say it was used in place of the symlink check.
- Lane check, MISTAKES.md:383 comment "and no other worktree's path in the log": this is not an executable command.
  Consider adding one, e.g. `grep -oE '/[^ ]*/\.claude/worktrees/[^ )]*' "$LOG" | grep -vF "$(git rev-parse
  --show-toplevel)" | sort -u` (must be empty).
- Transcript naming: `4.2-A-final-testFull.txt` (task 4.2) sits beside `4.2.A.txt` (race repeat 2), which is
  easy to confuse.
