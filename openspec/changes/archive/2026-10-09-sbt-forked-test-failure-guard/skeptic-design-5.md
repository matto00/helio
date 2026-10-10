## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b (the change dir is untracked; `git status` shows only the change
dir and the scratch test dir). Inputs: ticket.md, proposal.md, design.md, tasks.md, specs/backend-ci-test-execution/spec.md,
skeptic-design-1..4.md, the run's events.jsonl, the scratchpad repro logs `hel1468-*.log`, the ScalaTest sources in
`scratchpad/sbtsrc/st` and `stcore-skeptic2`, and the real CI backend job logs in `scratchpad/logs/`. I did not run sbt.

### What I verified (with evidence)

1. **Owner ruling.** `.concertino/runs/HEL-1468/events.jsonl` has `escalation.raised` (options `reword-spec,halt`) and
   `escalation.answered answer=reword-spec answer_source=human`. Both carry escalation_id `HEL-1468-1791607039254-e18d05`.
2. **Round-4 CR1 (suite naming) is fixed and true against the logs.** The spec requirement and scenario, Decision 3a and
   task 3.2 now point to the suite header line `[info] <Suite>:` followed by its `*** FAILED ***` test lines. I checked
   all 17 `hel1468-*.log` with ANSI stripped:
   - Every log has exactly one `[info] <Name>(Spec|Suite):` header.
   - Every failing log has its `*** FAILED ***` lines after that header (7, 40 or 1 of them).
   - This includes every lost-event run: loop1, loop2, m1b, many1, many2, many5 and many6. Each of these has
     `No tests to run` and `[success]`.
   - Example: many1 line 9 is `[info] Hel1468ScratchManyFailSpec:` and line 11 is
     `[info] - should fail deliberately 1 *** FAILED ***`.

   So task 3.2's check can be met. No `-oI` or other argument was added back, so Decision 4 still holds.
3. **Round-4 CR2 (run abort) is fixed.** The spec now limits the absolute promise to failed tests and suite aborts. It
   says a whole-run abort in a fork that exits 0 "SHALL fail the CI step; locally it is a documented residual risk".
   That now matches Decision 3b and task 4.1.
   - I checked the source. ScalaTest's sbt-side Skeleton reader dispatches a forked `RunAborted` to the reporter
     (`sbtsrc/st/.../Framework.scala:891`).
   - The reporter renders it as "RUN ABORTED" (`StringReporter.scala:790`).
   - All output goes through `logger.info` (Framework.scala:598,604).
   - So the line does reach the sbt log. The CI promise therefore depends entirely on the Decision 5 log scan, which
     brings me to item 4.
4. **NEW, blocking: Decision 5's anchored regexes cannot match a real CI `sbt.log`.** In CI, sbt writes ANSI-colored
   level tags into `$LOG`, so a line never starts with a literal `[info] `.
   - Evidence: three real `backend (0) / Compile and test` job logs, `scratchpad/logs/job-113627330552.log`,
     `job-113630785666.log` and `job-113633436798.log`. Each contains the `ci-sbt: mode=server` line, so the content is
     `ci-sbt.sh`'s `tail` of `$LOG`.
   - The `Tests:` line is at 16476 / 16443 / 16468. It reads, bytes per `od -c`, with gh rendering ESC as `^[`:
     `^[[0m[^[[0m^[[0minfo^[[0m] ^[[0m^[[0m^[[36mTests: succeeded 1802, ...`
   - Counts per log: 2286 ANSI-wrapped `info` tags, and **0** plain `Z [info] ` lines. The result was the same across
     all three logs.
   - Decision 5 matches against raw `$LOG` with `^\[info\] \*\*\* [0-9]+ (TEST|...) ...` and
     `^\[info\] \*\*\* RUN ABORTED`. Neither pattern can ever hit. The CI layer would be silently inert.
   - That breaks the spec's "CI log carries a failure summary" scenario. It also breaks the only guarantee the round-5
     spec gives for whole-run aborts ("SHALL fail the CI step").
   - Task 3.3's selftest would not catch this, because its fixture logs would be hand-written without color.
   - Round 2 raised this as a non-blocking note ("confirm sbt writes no ANSI codes into `$LOG` ... else the `^\[info\]`
     anchor never matches"). No task or decision ever picked it up. Round 4's CR2 made the CI scan load-bearing for
     run aborts, so it is now blocking.
   - Decision 1 already strips ANSI from the in-build parser, so this only affects the CI layer.
5. **Nothing else regressed.** These still match what rounds 3 and 4 accepted:
   - Decisions 1, 2, 3, 3b, 4 and 6, and the Risks section.
   - Tasks 1.x, 2.1, 2.2, 3.1, 3.4, 3.5 and 4.1.
   - Standing constraints C1 to C4.
   - The proposal's "What Changes" agrees with the spec.

### Verdict: REFUTE

### Change Requests

1. **Make the CI log scan ANSI-tolerant (Decision 5, task 2.3, task 3.3).**
   - Decision 5: before matching, strip ANSI SGR sequences from `$LOG`, e.g. `sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E ...`.
     Keep the existing anchored patterns, applied to the stripped text. Alternatively, run sbt with color off. If you
     pick that, state the exact flag and show that it removes the codes from `$LOG`.
   - Task 2.3 should say the same.
   - Task 3.3: add a selftest fixture whose summary and run-aborted lines are ANSI-wrapped exactly as sbt writes them in
     CI. The wrapper is `ESC[0m[ESC[0mESC[0minfoESC[0m] ESC[0mESC[0mESC[3Xm...`, modelled on the `Tests:` line verbatim
     at `scratchpad/logs/job-113627330552.log:16476` (ESC bytes, not gh's `^[` rendering). The fixture must exit 1.
   - Show a red case: the selftest fails against the unstripped regex.
   - This is a narrow fix inside the already-approved design, not a new mechanism.

### Non-blocking notes

- Task 3.5: you cannot pick which group starts first, so record which group actually started last on each run (carried
  from round 3). Keep the guard's line on green runs to a single line.
- The `*** FAILED ***` detail line also carries `(<File>.scala:N)`. The MISTAKES.md entry could mention it as a second
  way to find the suite.
