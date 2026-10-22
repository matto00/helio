## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: c3b30a4a5362b5cf451f23d90a3a7acf65052eae. Base, resolved live: da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9. The cycle delta is 62ebdbc0e..c3b30a4a5.

### Phase 1: Spec Review — PASS
Issues: none.

The cycle-3 delta touches one file, `scripts/e2e-backend-lane.selftest.sh` (`git diff --stat`: 1 file, +3/-2). The changes are:
- a timing comment;
- the stub's `sleep 6` is now `sleep 20`;
- `TOTAL_TIMEOUT` goes from `2` to `30`.

No product, workflow, action or `e2e-backend.sh` change, so cycle 2's Phase 1 findings stand. C1 and C2 are honoured: the real `concertino-servers/backend.pid` sha256 was `dbf3060d...` before and after my 8 selftest runs. It differs from cycle 2's value because the lane servers were restarted between cycles, not by this review.

### Phase 2: Code Review — PASS
The race named in `skeptic-final-1.md` (non-blocking note 1, promoted to a change request) is gone. My reasoning follows the `wait` loop in `scripts/e2e-backend.sh`. Each iteration does these steps in order:
1. health curl;
2. `elapsed >= TOTAL_TIMEOUT`;
3. group liveness (`kill -0 -- -pgid`);
4. stage check at `elapsed >= STAGE_TIMEOUT`.

Each failure the test must avoid is now ruled out:
- **Total timeout:** before, `TOTAL_TIMEOUT=2` sat one poll above `STAGE_TIMEOUT=1`. Now it is 30, so the total-timeout branch can only fire 29 s after the stage check is already due.
- **Dead group:** the stub lives 20 s, so the group-liveness branch cannot fire inside that window either.
- **Health curl delay:** the curl targets port 9 with `--max-time 3`. Even if it times out instead of being refused, it delays the stage check by at most a few seconds, still far inside both margins.

The stage check is then the only reachable failure. The stub log line (`stub-sbt PORT=... CORS_ALLOWED_ORIGINS=... cwd=...`) contains none of `compiling|done compiling|running (fork)|Nothing to compile`, so the case-4 grep for `hung before the compile/run stage` is deterministic.

There is a side effect: orphaned stubs now sleep 20 s instead of 6 s after the selftest exits. They are self-terminating and harmless; the selftest still finishes in 2-3 s.

Fresh evidence, run in WORKTREE_PATH:
- `npm run selftest:e2e-backend-lane` 8 times in a row: **8/8 passed**, 13/13 checks each, 2-3 s per run;
- `check:ci-sbt-guard` ok;
- `bash -n` ok.

Prettier has no parser for `.sh`, so the file is outside the format gate, as before.

### Phase 3: UI Review — N/A
No trigger path changed. The lane servers on 7131/10038 were left running and untouched.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- none new. Cycle 2's README line-length note still stands as cosmetic.
