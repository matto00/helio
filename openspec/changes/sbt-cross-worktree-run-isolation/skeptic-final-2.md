## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `b3654df09498b5d5990b6dedd588a2bfa3a9af9b`. Base resolved live via `resolve-review-base.sh`
(main/origin) = `e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90`. Diff touches MISTAKES.md and the change dir only;
`git diff base...HEAD --stat -- CLAUDE.md backend frontend` is empty. Working tree clean; probe dirs
`backend/src/{main,test}/scala/com/helio/probe` absent.

### What I verified (with evidence)

- **Spawn-cwd guard**: `READY ambient=/home/matt/Development/helio branch=bug/sbt-cache-cross-worktree-replay/HEL-1595`.
- **Round-1 CR1 (testFull overclaim), fixed**: MISTAKES.md now names the task per condition. `testFull` is claimed
  only for serial-after-B (1.3) and the new concurrent pair (5.*). Cold/warm load, live server and 5/5 race are
  explicitly "single-test `testOnly <probe>` runs". This matches the transcripts (`Total number of tests run: 1` in
  1.4/3.2/4.*.A, as I checked in round 1).
- **Round-1 CR2 (concurrent testFull gap)**: the executor ran the condition instead of only listing it. I checked
  the **full, untrimmed** logs in the session scratchpad, not just the trimmed transcripts in the repo
  (`scratchpad/HEL-1595/logs/5.A-testFull.log` with 96721 lines, `5.B-testFull.log` with 96738 lines):
  - A: both project lines name the HEL-1595 worktree. 49 own-path lines, 0 `treeB` lines, and no path from any
    other worktree. `Hel1595ProbeSpec` / `hel1595 probe *** FAILED ***` (line 58436),
    `Tests: succeeded 8083, failed 1`, `EXIT=1`, elapsed 758 s, `cache 62%, 400 disk cache hits`.
  - B: both project lines name scratchpad treeB, with 0 HEL-1595 paths. It compiled 549 main and 659 test sources
    (so B was cold), its probe passed, `Tests: succeeded 8084, failed 0`, `EXIT=0`, elapsed 784 s,
    `Run completed in 11 minutes, 52 seconds`.
  - Overlap: A's header records a start at 07:11:19. Both logs' mtimes are 07:23 (B) and 07:24 (A). The in-log
    elapsed times (B 784 s with 11m52s of test execution; A 758 s) place B's test phase at about 07:11–07:23 and
    A's run at 07:11:19–07:24. **Disclosure:** the overlap rests partly on file mtimes and partly on the header
    line, which is not self-authenticating. The files are in place in the scratchpad (not relocated), and the
    content-borne elapsed times are consistent, so I accept it. "B had executed 18 tests" at A's start is not in
    the captured content; it is the executor's claim. It is also not load-bearing, because the windows overlap by
    more than 11 minutes either way.
  - The trimmed in-repo transcripts (5.A/5.B) match the full logs on every line I compared.
- **Round-1 CR3, fixed**: MISTAKES.md:328 now says "observed but not captured in a transcript" for the
  command-mode no-server observation. The wording is redundant ("observed with ..., observed but not captured")
  but honest.
- **Round-1 CR4, fixed**: README.md no longer cites 3.1-B-procs.txt for the socket hash. It labels the hash
  comparison "session-only" and points to 3.2-c as the transcript evidence. Row 1.5 carries the same caveat.
- **Round-1 non-blocking heading note**: addressed. The heading now ends "(refuted for tested invocations, HEL-1595)".
- **Untested gaps named**: MISTAKES.md "Not verified" and README "Untested conditions" both list the real
  `~/.cache/sbt`, a native `sbtn`, and a live detached `sbt run` in the other tree. The last one is the closest
  remaining model of the incident, and it is honestly stated as not run. The concurrent-testFull gap is now
  closed with evidence rather than listed.
- **Verified/inferred labelling**: "Not reproduced (verified ...)" is backed by transcripts. The explanation of
  what HEL-1446's skeptic saw stays under "Not verified ... best-supported inference". This is honest.
- **Lane check, re-run on testFull-scale logs**: I ran the MISTAKES.md check verbatim from this worktree on both
  full concurrent logs.
  - On 5.A it shows own project lines and 49 own-path hits, the foreign grep prints nothing, and the counts are
    non-zero. It accepts A, which is correct.
  - On 5.B it shows treeB project lines and **0 own-path hits**, so it rejects B as not this lane's run, which is
    also correct. The third grep did not fire because the foreign path is not under `worktrees/`. The first two
    lines carry the check, as I noted in round 1.
  - The check is read-only and safe.
  - Round 1 also ran it on a real `testOnly` from this worktree, plus a path-rewritten negative copy.
- **ACs**:
  - (1) Reproduced the setup with two trees at the same code, a failing probe in A and a shared relocated cache.
    The cache location and key inputs are in `cache.md`. A cached `testFull` did not come from the other tree,
    shown serially, concurrently and under the testOnly matrix.
  - (2) The fix branch does not apply: no reproduction, and no build change, which is correct.
  - (3) What the skeptic saw was investigated: `forensics.md`, server/BSP attach (3.2), cache contents and log
    interleaving. It is reported as unexplained, with the inference labelled as inference.
  - (4) MISTAKES.md has a new entry and a lane check. The CLAUDE.md bare-`sbt test` note is unchanged and still
    accurate; 1.3 and 5.A executed tests at high cache %. The HEL-1374 entry is reconciled as "refuted for
    tested invocations".
  - Driver constraints: the experiments used a scratchpad cache (`-Dsbt.global.localcache=$S/cache`, seen in
    `scripts/race.sh`), and no change was made under `~`.
- I did not run sbt this round. Every claim I checked is grounded in captured logs, so no re-run was needed.

### Verdict: CONFIRM

### Non-blocking notes

- MISTAKES.md:328: "(observed with `sbt 'eval Thread.sleep(45000)'`, observed but not captured in a transcript)"
  repeats "observed". Could read "(seen with ..., not captured in a transcript)".
- MISTAKES.md:369: "started once B was executing tests" rests on an uncaptured header claim. The timing
  corroboration (mtimes plus elapsed) is adequate but not self-authenticating. A future rerun could log
  `date +%T` plus `grep -c '^\[info\] - '` of B's log at A's start into the transcript itself.
- The `cache.md` sample was "0 of 3000 sampled entries in `~/.cache/sbt/v2/ac`". It is read-only, but it is the
  shared cache, so the sentence could say explicitly that it was read, never modified. The driver constraint
  forbids changing that cache, not reading it.
- No gate defect: neither report relied on mtimes from an evidence directory that was disclosed as unsound.
