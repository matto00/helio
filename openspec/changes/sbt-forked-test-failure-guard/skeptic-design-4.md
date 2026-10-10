## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b (the change dir is untracked). Inputs: ticket.md, proposal.md,
design.md, tasks.md, specs/backend-ci-test-execution/spec.md, skeptic-design-1/2/3.md, the run's events.jsonl, and the
scratchpad repro logs `hel1468-*.log`. I did not run sbt.

### What I verified (with evidence)

1. **Owner ruling exists and is the one claimed.** `/home/matt/Development/helio/.concertino/runs/HEL-1468/events.jsonl`
   line 8 has `escalation.raised` (options `reword-spec,halt`). Line 9 has `escalation.answered answer=reword-spec
   resolution_channel=chat answer_source=human`, with the same escalation_id `HEL-1468-1791607039254-e18d05`.
2. **Round-3 CR1 mechanics are applied.**
   - Decision 3a drops `-oI` and says why.
   - Task 2.2 says "add no ScalaTest argument".
   - Task 3.1's fixture list no longer has "with -oI reminder".
   - The spec requirement and the "Lost forked-test events" scenario now ask for counts plus a pointer to the per-test
     lines.
   - Decision 4 still holds: the design adds no `Tests.Argument`.
3. **Nothing else regressed.** Decisions 1, 2, 3 and 3b, 5 and 6, the Risks, and tasks 1.x, 2.1, 2.3, 3.3, 3.4, 3.5
   and 4.1 match what round 3 accepted. C1 to C4 are intact.
4. **The revision's new premise is FALSE against the repro logs.** Decision 3a says the per-test `*** FAILED ***` lines
   "name each failed test's suite". Task 3.2 checks that "a per-test `*** FAILED ***` line names the scratch suite". The
   logs disagree:
   - In every lost-event run I checked (many1, many2, many5, loop1, m1b; each has `No tests to run` and `[success]`),
     `sed 's/\x1b\[[0-9;]*m//g' | grep '\*\*\* FAILED \*\*\*' | grep -c -E 'Spec|Suite'` gives **0**.
   - The lines look like `[info] - should fail deliberately 1 *** FAILED ***` (many1:11). They name the test, not the
     suite.
   - The suite appears on a separate header line, `[info] Hel1468ScratchManyFailSpec:` (many1:9), placed before that
     suite's tests.
   - The suite also appears indirectly as a file name in the detail line after each failure:
     `(Hel1468ScratchManyFailSpec.scala:10)` (many1:12).
   - loop1 has the same pattern: header `[info] AnalyzeSchemaSharedDefsSpec:` at line 7.

   So task 3.2's acceptance check cannot pass on any run. An executor following it literally gets a check that is
   always false. An executor bending it would quietly weaken a binding check. The driver's brief also asserted that
   these lines name the suite. That claim does not survive the logs. The escalation's parenthetical "(which name the
   suite)" carried the same wrong fact.
5. **The spec still says more than the design delivers on run aborts.**
   - The spec requirement says any invocation "in which ... a suite or run aborts SHALL exit non-zero ... locally or in
     CI".
   - Decision 3b, and task 4.1's "residual RUN ABORTED" item, say otherwise: "a `RunAborted` inside a fork that still
     exits 0 is the residual gap", caught only by the CI log scan, and "locally only the log line reveals it".
   - The spec therefore makes an absolute local promise that the design says will not be kept. A final-gate reviewer
     checking against the spec would have to REFUTE the shipped work for a gap the design meant to accept.
   - Rounds 2 and 3 asked for the gap to be recorded as a residual, but never reconciled the spec text. It is cheap to
     fix now.

### Verdict: REFUTE

Two narrow wording fixes. The approach itself is sound.

### Change Requests

1. **Correct which log line names the suite (Decision 3a, spec requirement and scenario, task 3.2, and the guard
   message wording).**
   - ScalaTest names the suite on the header line `[info] <SuiteName>:` that comes before its per-test
     `- <test> *** FAILED ***` lines. The failure detail line also carries the source file and line, e.g.
     `(<File>.scala:N)`.
   - Reword Decision 3a and the spec so that the guard's thrown message points to ScalaTest's per-suite output earlier
     in the same log, where each failed test's `*** FAILED ***` line appears under its suite's header line.
   - Reword task 3.2's check to: the log contains the scratch suite's header line `[info] Hel1468Scratch...Spec:`
     followed by at least one `*** FAILED ***` line.
   - This corrects a factual premise. It does not reopen the owner's ruling: counts plus a pointer to the log's
     per-test output stays, with no new mechanism and no ScalaTest argument.
2. **Make the spec's run-abort promise match Decision 3b.** Pick one of these rewordings of the spec requirement:
   - Split it: failed tests and suite aborts SHALL make every path exit non-zero. A run abort SHALL fail the CI step
     (the `ci-sbt.sh` scan), and locally is a documented residual (MISTAKES.md).
   - Or add a scenario stating the residual explicitly.

   Do not leave an unqualified "or run aborts SHALL exit non-zero ... locally".

### Non-blocking notes

- Round 3's notes on task 3.5 still apply: you cannot control which group starts first, so record which group started
  last on each run. They also ask that the guard line on green runs stay to one line.
