## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `ea2d2beb0ec2fcc030cfa0e003b1e9bfcc8200a9`. Diff base, resolved live: `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`.

Changes in this cycle (`d5ec9a829..ea2d2beb0`):
- `PipelineRunServiceTerminalOrderingSpec.scala`
- `files-modified.md`
- `evaluation-2.md` (committed by the executor)

`git diff --stat d5ec9a829 ea2d2beb0 -- backend/src/main` is empty, so production code is byte-identical to cycle 2.

My evidence is copied to `/home/matt/Development/helio/.concertino/runs/HEL-1366/evidence/evaluator-cycle3/`. Every claim below rests on file content, not on mtimes.

| Log | What it shows |
|---|---|
| `eval3-base.log` | The spec at HEAD against the pre-fix base `PipelineRunService.scala`, run under `timeout 400`. It completed in 15 s wall time (ScalaTest "Run completed in 6 seconds"), exit 1. **5 ordering cases FAILED**, all at `PipelineRunServiceTerminalOrderingSpec.scala:195` (`sub.terminals shouldBe empty`). The message "terminal event received while write blocked" appears 5 times. The 2 failing-write cases passed. No hang. |
| `eval3-mutC1.log` | My cycle-1 mutant (`flatMap` plus double publish): 7/7 FAILED. |
| `eval3-mutM1.log` | Mutant that never publishes on a failed write: exactly the 2 failing-write cases FAILED, at `:183` (no terminal event). The other 5 passed. |
| `eval3-green{1,2,3}.log` | Real code: 7/7 passed in each of three repeats, and 7 tests really ran each time. |
| `eval3-testFull.log` | `sbt testFull` at ea2d2beb0: 6092 succeeded, 0 failed, 4 canceled, exit 0. |
| `eval3-hel1094-repeat.log` | hel1094 `--repeat-each=4 --workers=2` under `nice -n 19`: 4 passed, against a backend restarted at HEAD. I stopped the stale cycle-1 backend by its exact PID (2311438; I had started it at 14:29:43 with cwd in this worktree) and started a new one with `start-servers.sh` (PID 2929309, started 15:43:12). The frontend was reused because it has been unchanged since the base. |

The mutant and base runs used one throwaway detached worktree at ea2d2beb0. I removed it with `git worktree remove --force` on its exact path, and `git worktree list` shows no straggler. The top-level `e2e-evidence/` directory did not exist at any point this cycle (hel1094 does not call `evidencePath`), so I had nothing to move.

### Phase 1: Spec Review — PASS

- **AC1:** root cause fixed at the cause; the 120 s waits are untouched. Established in cycle 1, and the main code is unchanged since cycle 2.
- **AC2:** red-first, deterministic, lock-holding proof on every terminal path. The suite against the pre-fix ordering now **completes red**: 5/5 ordering cases fail at the ordering assertion, after the `pg_blocking_pids` checks that guard against vacuous passes. This is the clean red that C6 requires.
- **AC3:** hel1094 4/4 at HEAD (fresh backend). The executor's run and my cycle-1 run were both 4/4 as well.
- **AC4/AC5:** helper consolidation verified in cycle 1 and unchanged since.
- **D2:** "exactly one terminal event, even when a terminal write fails". Each half has a guard, and I showed each guard can go red on its own:
  - The double-publish half is caught by the witness bus, through the C1 mutant and the cycle-2 M2 mutant.
  - The publish-on-failure half is caught by M1, which kills exactly the 2 trigger cases.
- **Constraints C1–C6:** honoured.

**On the 2 trigger cases passing against the base: acceptable.** On the base, publish happens first, so the base already publishes exactly one terminal event when a write fails. The property they assert was already true before this change; the ticket did not break it. What the ticket introduced is the *risk* of losing that property, because publishing after the writes means a failed write could swallow the event. That makes these cases regression guards for the new code shape, not red-first proofs of the ordering fix.
- The AC's red-against-pre-fix requirement covers the ordering. That requirement is met by the 5 ordering cases, which span every terminal path.
- D2 asks only that tests *assert* the single event on the failure path, and these do. M1 shows they fail when the new code drops publish-on-failure.
- files-modified.md states this distinction explicitly rather than claiming 7/7 red on the base.

### Phase 2: Code Review — PASS

Gates I ran myself at HEAD:
- `sbt testFull`: 6092/0.
- The ordering spec: green 3×, base red, mutants red.

Lint, format and scala-quality were clean at cycle 2. This cycle changed one Scala test file and one markdown file, and that Scala file compiled and ran in every run above.

Cycle-2 change request, checked against the code:
- (a) **Done.** Every `Held` is registered in `heldLocks` inside `hold` before the lock statement runs. `afterEach` releases all of them in `try`/`finally` and then clears the list. `Held.release()` is `synchronized` and idempotent (a `released` flag, then rollback-then-close in `try`/`finally`). The base run shows the effect: after the 5 ordering failures, the 2 trigger cases ran and passed instead of hanging.
- (b) **Done.** `SET lock_timeout = '5s'` runs on the DDL connection before any DDL. `CREATE FUNCTION` and `CREATE TRIGGER` are now inside the `try`. The `finally` block drops the trigger and then the function by exact name (`hel1366_fail_terminal_<pipelineId without dashes>`), with the function drop in a nested `finally`. The function is therefore dropped even if trigger creation or the trigger drop fails.
- (c) **Done.** I reproduced it independently, as above: a bounded run that completes red.

Non-blocking:
- `lock_timeout` is session-scoped on a dedicated connection. That is correct, but it also applies to the `DROP` statements, which is desirable.
- No other code issues.

### Phase 3: UI Review — N/A
No UI-trigger paths changed. hel1094 was re-run at HEAD as AC3 evidence, as shown above.

### e2e-evidence (carried from cycle 2)
The tooling defect on `main` still stands for a follow-up ticket. HEL-1363 created the gitignored top-level `/e2e-evidence/` directory but never added it to `IGNORED_TOP_LEVEL` in `scripts/check-no-credential-in-agent-surface.mjs`, so the next commit after any `evidencePath` e2e run fails the coverage-drift guard. It did not occur this cycle.

### Overall: PASS

### Non-blocking Suggestions
- Open the follow-up ticket for adding `e2e-evidence` to `IGNORED_TOP_LEVEL`, with a self-test case.
- Propose the `PipelineRunService.scala` split (files-modified.md) in the PR description as its own behaviour-preserving ticket.
- The dev servers on 6798/9705 are now running HEAD (backend restarted at 15:43:12).
