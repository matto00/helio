## Skeptic Report — design gate (round 6, skeptic-design-6.md)

This is a delta review only. It covers round 5's single change request (CR1: the CI log scan must tolerate ANSI
codes). I reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b. The change dir is untracked. I did not run sbt and
did not touch `hel1468scratch/`.

### What I verified (with evidence)

1. **The delta is present and consistent across all three artifacts.**
   - design.md Decision 5 now strips ANSI with `sed 's/\x1b\[[0-9;]*m//g'` before applying the unchanged anchored
     patterns.
   - tasks.md 2.3 says "ANSI stripped first".
   - tasks.md 3.3 adds an ANSI-wrapped summary and a RUN ABORTED fixture. Both use real ESC bytes, are modelled on a
     real CI line, expect exit 1, and include a red case against the unstripped regex.
   - The spec scenario "CI log carries a failure summary" still covers a failed summary, an aborted summary and a
     run-aborted line.
   - Nothing else changed in the design.

2. **Which form the anchor has to handle.** `scripts/ci-sbt.sh` writes sbt's stdout and stderr straight into `$LOG`
   (`setsid ... > "$LOG" 2>&1`). The GitHub job log is that file copied verbatim by `tail -f`, with a
   `YYYY-MM-DDTHH:MM:SS.fffffffZ ` timestamp that GitHub adds to the front of each line. The scan reads `$LOG`, so the
   timestamp is never there and `^` sits right at the ESC byte. To rebuild the `$LOG` form for my checks, I removed
   that timestamp from each job-log line and did nothing else.

3. **The saved round-5 sample logs cannot test this, so I fetched fresh logs.** The saved
   `scratchpad/logs/job-*.log` files contain 0 raw ESC bytes (`grep -c $'\x1b'` = 0). ESC is stored there as the two
   characters `^[`. I fetched fresh logs with `gh api --allow-escape-sequences` into `scratchpad/skeptic6/`:
   - Two passing backend shards from main run 38024204173: jobs 114131456380 and 114131456407. These have 2361 and
     2169 raw ESC bytes, 0 CRs, and the `ci-sbt: mode=server` line.
   - Six failed backend jobs: 114064543620, 113204133537, 113058618936, 112970193313, 112686767581 and 112672962624.

4. **The exact sed plus the anchored patterns, run against real `$LOG`-form lines.**
   - Failing jobs:

     | Job | Unstripped hits | Stripped hits | Matched line |
     |---|---|---|---|
     | 114064543620 | 0 | 1 | `[info] *** 1 TEST FAILED ***` |
     | 112970193313 | 0 | 1 | `[info] *** 1 TEST FAILED ***` |
     | 112686767581 | 0 | 1 | `[info] *** 1 TEST FAILED ***` |
     | 113204133537 | 0 | 1 | `[info] *** 1 SUITE ABORTED ***` |

     The raw line looks like `ESC[0m[ESC[0mESC[0minfoESC[0m] ESC[0mESC[0mESC[31m*** 1 TEST FAILED ***ESC[0mESC[0m`. The
     sed also removes the trailing `ESC[0mESC[0m`, so the `\*\*\*$` anchor holds.
   - Job 113058618936 has no ScalaTest summary at all; sbt failed before any tests ran. sbt's own non-zero exit covers
     that case, so 0 hits is correct.
   - Passing jobs 114131456380 and 114131456407: 0 hits, both unstripped and stripped. After stripping, their lines
     read `[info] Tests: succeeded 1731, failed 0, ...` and `[info] All tests passed.`, so neither pattern matches the
     passing forms.
   - The unstripped regex has 0 hits on every log. That shows the red case in task 3.3 is real and the fix is needed.

5. **Escape sequences other than `ESC[...m`.** I listed every ESC form in the seven logs that ran under
   `ci-sbt: mode=server`.
   - Apart from SGR codes, there is exactly one `ESC[0J` per log.
   - It always sits on its own line after sbt's final `[success]`/`[error] elapsed time` line, never on a summary line.
     So it cannot break the anchor in the current mode.
   - **Caveat:** job 112672962624 has no `ci-sbt: mode=` line. It ran before `ci-sbt.sh` existed, in the thin-client
     era. In that log every line is wrapped in `ESC[0J` (19424 lines). There, the SGR-only sed leaves
     `ESC[0J[info] *** 1 SUITE ABORTED ***ESC[0J`, which gets 0 hits.
   - A full CSI strip, `sed 's/\x1b\[[0-9;?]*[A-Za-z]//g'`, matches that log too.
   - `ci-sbt.sh` pins `--server`, and HEL-1362 removed the thin-client lever. So this case cannot happen today, and I
     list it below as a note rather than a blocker.

6. **No real CI sample of `*** RUN ABORTED ***` exists**, which is expected. Per round 5, ScalaTest sends it through
   the same `logger.info` path, so it gets the same wrapper, and the prefix-anchored pattern
   `^\[info\] \*\*\* RUN ABORTED` works on it once the codes are stripped. The task 3.3 fixture tests this.

7. **GNU sed supports `\x1b`**. Every stripped-hit count in item 4 came from running that exact sed string myself.

### Verdict: CONFIRM

Round 5's CR1 is fixed. Against real `$LOG`-form CI lines, the stripped scan matches every failed and aborted summary
form, matches nothing on passing runs, and the unstripped form matches nothing.

### Non-blocking notes

- Consider widening the strip to all CSI sequences (`s/\x1b\[[0-9;?]*[A-Za-z]//g`). It costs nothing, and it survives
  the per-line `ESC[0J` prefix seen in the thin-client-era job 112672962624 if that mode ever returns.
- Task 3.3 fixtures: model them on real failing lines rather than the passing `Tests:` line. Examples:
  - `*** 1 TEST FAILED ***`: job 114064543620, log line 16698.
  - `*** 1 SUITE ABORTED ***`: job 113204133537, log line 15702.
  - Use the line with the GitHub timestamp removed, i.e. the `$LOG` form.
- Carried from round 5: task 3.5 should record which group actually started last, and the MISTAKES.md entry could
  mention `(<File>.scala:N)` as a second way to find the failing suite.
