## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 673f987692628237636e41790d93d74b1f6ff1f0 against live base 4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec
(resolve-review-base.sh). Diff: 3 e2e specs + change dir only. Spawn guard: READY.

### Phase 1: Spec Review — PASS
- AC1 (red first, then 40/40 throttled) for the three ticket tests:
  - :487 (now :493): red 3/21 at CDP 6x (`red-run-cdp-throttle6.txt`, "intermediate frames", 1 >= 2). 40/40 at 6x
    (`green-40x-hel1584-cdp6.txt`, 40 passes of :493).
  - :562 (now :600): red in light under taskset 2-core (`red-run-taskset-2core.txt`, "the check pops"). 40/40 light and
    40/40 dark at 6x (same file). Dark was never shown red before the fix. It is the same parametrised test, so this
    is acceptable.
  - hel1260 :108 (now :137): red 5/12 at 20x (`red-run-hel1260-cdp20.txt`, null `.x`). 40/40 light and 40/40 dark at 20x
    (`green-40x-hel1260-ui-cdp20.txt`).
- AC2 (controls still red): controls A-F are each red (`control-A..F*.txt`). Control E fails at the new clock-edge poll.
  Control F fails at the new pop poll in both themes.
- AC3 / C1: no retries, no timeout options, no raised thresholds. Every `expect.poll` uses the default expect timeout,
  and `retries: 0` is unchanged. The one numeric relaxation (between-frames floor 2 -> 1) follows the ticket's own
  fix text. A second, independent hard-cut signal and a new "reached the new bars when the clock finished" assertion
  compensate for it (see Phase 2).
- AC4 (green in CI on the merged head) is a delivery-phase check. It is still open, and the orchestrator owns it.
- Sweep scope: the fixes and the not-fixed items are listed with reasons in `sweep-list.md`. There are no product
  changes (C3), and tasks.md matches the diff.
- C2-C4 are honored. I checked the harness myself: it is not in the commit, and the tree is clean after my temporary
  apply and revert.

### Phase 2: Code Review — PASS
Gates (fresh, on the 3 changed e2e files): eslint `--max-warnings 0` OK, prettier `--check` OK, and
`tsc --noEmit -p e2e/tsconfig.json` OK. The frontend/backend gate triggers do not match (only `e2e/**` and
`openspec/changes/**` changed).

(a) :493 morph. The poll returns true only if a recorded zrender clock edge with `t >= refreshedAt` is `unfinished`
and a later edge is finished. With `animationDurationUpdate: 0` or `animation: false`, the clock never goes unfinished,
so the poll times out red (control E). The second signal stands on its own: `between >= 1` needs a sampled frame
strictly inside the 5%-95% band between the old and new sums. A hard cut swaps the display list atomically between
rAF samples, so it gives 0 such frames even if some unrelated zrender animation satisfied the clock poll. Both signals
must hold, plus the new "after.at(-1) within 5% of final" and "min/settled > 0.4" checks. The 1-frame floor cannot
pass a hard cut.

(b) :600 pop. The poll is `>= 1` on motion-pop `motion-enter` records with the default timeout. Control F, which
removes the pop class, fails it in both themes. The curve assertion is unchanged.

(c) settledGridItemBox. There is no retry wrapper and no timeout option, so the default 5s expect timeout applies.
The helper returns true only when the current box is non-null and equal (< 0.5px) to the previous non-null read. A box
that is always null never matches, because `box !== null` is required, so it times out red. A box that keeps changing
also never matches. The non-null assertion on `return previous!` is safe: the poll only succeeds after assigning a
non-null `previous`. Probe-confirmed cause: `probe-hel1260-cause.md` shows a transient null while the node is connected.

(d) No retries, no larger timeouts and no loosened thresholds anywhere in the diff. I checked every hunk.

(e) Transcripts: confirmed as above for :487, :562 light/dark and :108 light/dark. **:24 (the orphan test, now :54)
is not supported as claimed.** Its only red is at **30x** (`red-run-hel1260-orphan24-prefix-cdp30.txt`, a prefixed
copy of the old code, 13 failures at old :95). At **20x** the old code passed 12/12
(`red-run-hel1260-orphan24-prefix-cdp20.txt`). The fixed code's green runs are 20x only, with 20 passes per theme,
not 40 (`green-20x-hel1260-orphan24-cdp20.txt`, 40 total; `green-10x-hel1260-orphan-cdp20.txt`). So the evidence
never shows :24 red and then green at the same throttle. My fresh 30x run of the fixed :24 failed 3/6, all at the
settled-box poll timing out. The trace shows why: at 30x a single `boundingBox()` spent 4.5s just resolving the
locator, and the poll finished fewer than two iterations inside 5s. The failure comes from extreme throttle (5x above
the AC's 4-6x range), not from a null or unstable box. It is still an improvement over the old code (13/16 red at 30x
-> 3/6). :24 is a sweep item, not one of the ticket's three tests, so this does not block. The executor's claim about
it still overstates what the evidence shows.

The rest of the checklist is clean: DRY, readable, typed (`Page`/`Box`), no dead code, no over-engineering, and the
change is behavior-preserving apart from the intended waits.

### Phase 3: UI Review — N/A
None of `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changed.

### Fresh evidence (this evaluator, HEAD 673f98769, harness applied temporarily then reverted)
- `/home/matt/Development/helio/.concertino/scratch/HEL-1658/eval-1/fresh-cdp6.txt`: 6x, repeat-each 2, :493 + :600
  (both themes) + all hel1260 tests: 13 passed, 1 failed. The failure was the first :493 run, at **unchanged line 500**
  (`.chart-panel__canvas canvas` toBeVisible 5s, the first chart load on a freshly started server). Its second run
  passed. This wait is pre-existing and outside the diff, the same class as the known hel1573 :103 line-114 wait.
- `/home/matt/Development/helio/.concertino/scratch/HEL-1658/eval-1/fresh-orphan24-cdp30.txt`: 30x, :54 repeat-each 3:
  3 passed, 3 failed at the settled-box poll (analysis above).

### Overall: PASS

### Non-blocking Suggestions
- In the PR body or handoff, correct the :24 claim: red only at 30x and green only at 20x, with 20/20 per theme.
  Neither rate shows red-then-green.
- The settledGridItemBox doc comment says the reads are "one animation frame apart". They are really at least one rAF
  plus the poll's back-off interval (100ms-1s) apart. Reword it to keep the claim accurate. The check itself is fine.
- The control-E and control-F transcripts record only a diffstat, not the mutation itself. Include the one-line diff
  next time, so the "hard cut" can be verified from the evidence alone.
- :493 line 500's 5s canvas-visible wait can trip on a cold server under throttle. The wait is pre-existing and out of
  scope, a possible follow-up alongside the hel1573 :103 wait.
