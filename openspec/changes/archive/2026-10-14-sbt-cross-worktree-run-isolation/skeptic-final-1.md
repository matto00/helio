## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c203e7b28414ed54377342013b71d1f8d42d4c8e`, base resolved live via `resolve-review-base.sh` =
`e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90` (main/origin from workflow-state.md). Diff: MISTAKES.md (+66/-12) and the
change dir (investigation/ + transcripts). No build, source or CLAUDE.md change.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/sbt-cache-cross-worktree-replay/HEL-1595`.
- **Serial cache-replay, testFull (AC1, the ticket's core red-first test)**: `transcripts/1.3-A-testFull-red.txt` lines
  2-3 name HEL-1595; `Hel1595ProbeSpec ... *** FAILED ***`; `Tests: succeeded 8083, failed 1`; `cache 100%, 644 disk
  cache hits`; `EXIT=1`. B's preceding probe run (`1.3-B-probe-green.txt`) names treeB and passes (EXIT=0). This is
  real support for "a cached testFull does not replay another tree's green", and for "`cache 100%` is not the tell".
- **Cold/warm build load (1.4)**, **live B server (3.2-a/b/c)** and **5 race repeats (4.1-4.5)**: every A transcript
  names A in both project lines, probe failed, `Total number of tests run: 1`, EXIT=1; every B transcript names treeB,
  EXIT=0. I grepped A transcripts for `treeB`: 0 hits. `3.2-c-client.txt` shows `starting sbt server in the background`
  then A's project lines, so `--client` did not attach to B. Race start records (4.*.start.txt) show A started at B log
  line 76-79, i.e. inside B's `compiling 550 Scala sources` phase (line 76) — the overlap is real.
- **All of 1.4, 1.5 and 1.6 ran `testOnly` of the 1-test probe, not `testFull`.** The only `testFull` with the failing
  probe is 1.3 (serial). Verified by `Total number of tests run: 1` in 1.4-A-cold/warm, 3.2-a/b/c, 4.1-4.5 A.
- **Forensics claim**: original HEL-1446 skeptic report (evidence/.../skeptic-final-1.md:44) confirms the observation
  as summarised (cwd via /proc, HEL-1451 paths in project lines and warnings, `cache 100%, 644 disk cache hits`, 8079/0).
- **Labelling of the explanation**: README.md and MISTAKES.md both label the "JVM whose base dir was the other tree"
  explanation as inference and state what the skeptic saw is unexplained. Honest.
- **Lane check (MISTAKES.md ~383-392) — run myself, verbatim**: fresh `nice -n 19 sbt -batch
  -Dsbt.server.autostart=false "testOnly ScalaTestSummaryGuardSpec"` from this worktree's backend/ (EXIT=0, 8 tests).
  On that log: both project lines name HEL-1595, own-path count 2, foreign-worktree grep prints nothing, counts match.
  On a copy with the worktree path rewritten to `task/stale-pipeline-comments-readme/HEL-1451`: own-path count 0
  (grep exit 1) and the foreign grep prints the HEL-1451 `loading project definition` line. The check works and is
  read-only, safe for lanes.
- **CLAUDE.md bare-`sbt test` note**: unchanged and still accurate — 1.3 shows `testFull` executed tests at `cache 100%`
  (testGrouping uncached), consistent with "bare `test` may run zero, use `testFull`".
- **HEL-1374 entry reconciled**: MISTAKES.md:319-344 rewritten from "reported, not reproduced" to "Refuted for the
  invocations tested", citing 3.2 runs. Matches transcripts 3.2-a/b/c.
- **Probe removed**: `git status --short` shows only the untracked evaluation-2.md; `backend/src/test/scala/com/helio/probe` absent.
- **Evaluator's non-blocking note confirmed**: `3.1-B-procs.txt` holds 4 process lines, no socket hash / active.json.

### Verdict: REFUTE

The investigation itself is sound and the conclusion "not reproduced" is supported. What does not ship is the
binding lane document labelling as **verified** something the transcripts do not show. MISTAKES.md is the file
lanes trust over their own judgement; a "verified" claim broader than the evidence is exactly the false confidence
this ticket exists to remove. The fixes are small wording changes.

### Change Requests

1. **MISTAKES.md:365-369 overclaims the testFull coverage.** "A failed in `testOnly` and in `testFull` (exit 1,
   `Tests: succeeded 8083, failed 1`) ... in every one of: serial after B, cold and warm build load, a live server in B
   (...), and 5 of 5 repeats" reads as testFull having been run under every listed condition. It was run under one
   (serial after B, transcript 1.3); the other four conditions ran `testOnly` of a single probe test
   (`Total number of tests run: 1` in 1.4-*, 3.2-*, 4.*.A). Reword so each condition names the task actually run,
   e.g. "`testFull` serially after B (8083 ok, 1 failed, exit 1); `testOnly <probe>` for cold/warm load, live server
   in B, and 5/5 race repeats".
2. **Name the concurrent-testFull gap in the "Not tested" list (MISTAKES.md ~377-379 and investigation/README.md
   "Untested conditions").** The observed incident was a ~11-minute `testFull` running while another lane ran
   `testFull`/`sbt run`. The race repeats overlapped A's cold `testOnly` with B's compile phase only; A's `testFull`
   concurrent with B's test-execution phase was never run. Add it to the untested list (no need to run it).
3. **MISTAKES.md:328-329 states an uncaptured observation without caveat.** "A command-mode `sbt "<cmd>"` ... started
   no server (no `project/target/active.json`)" — README.md says that `ls`/`cat` output was "observed in the session
   but not captured" (3.0-B-sbt-sleep-default.txt is sbt stdout only). Mark it "(observed, not captured in a
   transcript)" in MISTAKES.md, as README already does.
4. **investigation/README.md:27-28**: fix the citation that says the socket hash dir is in 3.1-B-procs.txt (it holds
   4 process lines and no hash/socket/active.json text). Either state that the hash comparison was session-only, or
   drop the citation. The "different socket hash" claim in README row 1.5 should carry the same session-only caveat;
   the self-authenticating evidence for "did not attach" is 3.2-c's `starting sbt server in the background` plus A's
   project lines and failed probe — cite that instead.

### Non-blocking notes

- MISTAKES.md:319 heading still asserts "sbt can attach to another worktree's server..." while its body now says
  "Refuted for the invocations tested". Consider a heading that does not contradict the body (e.g. append
  "(refuted for tested invocations, HEL-1595)").
- Lane check, third grep: `grep -vF "$(git rev-parse --show-toplevel)"` would also suppress a foreign path that has
  the own toplevel as a prefix (e.g. `.../HEL-159` vs `.../HEL-1595`), and only scans `worktrees/` paths, so a run that
  printed the main checkout's `/home/matt/Development/helio/backend` is caught only by the first two lines. The first
  line ("both lines must name YOUR worktree") covers both; acceptable.
- `cache.md`'s "0 files contain a tree path" grep over `cas/` may be blind to compressed blobs (zinc analysis);
  the empirical 1.4 cold run (A's build.sbt warnings name A against a B-populated cache) is the stronger evidence
  and is what should be cited for "no path replay".
- No mtime-ordering evidence is relied on by this gate or the evaluator's reports I read.
