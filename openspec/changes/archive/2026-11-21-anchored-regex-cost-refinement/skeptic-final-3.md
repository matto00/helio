## Skeptic Report — final gate (round 3, skeptic-final-3.md)

I reviewed HEAD `1395d572f9778b8703665f6ece3bfa7315d49874`. The diff is against the live review base `590474dcd1122e6625d3ddc7bc387599b028b3a3` (`resolve-review-base.sh`, exit 0). This is the same base as round 2.

Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/anchored-regex-cost-refinement/HEL-1807`.

This change has no UI, so the visual design step does not apply. Every measurement ran under `nice -n 19`, one process at a time, on the 7600X. The shipped `frontend/src` evaluator was transpiled with the frontend's own TypeScript, and no exports were added.

### What I verified (with evidence)

- **Cycle 3 changes no code.**
  - `git diff --stat 72da89831 1395d572f` touches only the change directory: `calibrate-anchored.mjs`, `calibration.md`, `files-modified.md`, `mutations.txt` and `skeptic-final-2.md`.
  - So round 2's code review and its fresh gates still apply to the shipped source: soundness by reading, 8,400-cell fuzz with 0 mismatches, jest 925 passed, typecheck, eslint and prettier. The review base has not moved either.
  - `git diff 590474dcd...HEAD -- shared-test-fixtures` is 0 lines, so the parity corpus is unchanged.
- **The Group H claims match the committed table.** I extracted the table from `calibration.md` into `groupH-rows.txt`:
  - 248 rows;
  - 161 rows over 20 ms;
  - 0 rows over 50 ms;
  - worst 36.00 ms;
  - 0 rows DECLINED (no sizing errors).
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-3/groupH-rows.txt`
- **The worst rows reproduce.** My own probe (`probe.mjs`) runs the shipped `workExceedsBudget` plus `exec`, sizes each frame to the largest cell with exact charge at or under 4.00e6, and records first/best/median/max of 9 runs. Every frame was admitted.

  | Frame | Recorded | My best | My max |
  |---|---|---|---|
  | `^([^<64>]+)`, Cyrillic + `\ud800` at the end, 1,000 x 1,997 | 36.0 ms class | 35.21 ms | 36.65 ms |
  | `^([^<64>]*)`, CJK + end, 1,000 x 1,997 | 36.0 ms | 35.24 ms | 36.96 ms |
  | `^([^<64>]+)`, CJK + end, 20,000 x 97 | — | 36.22 ms | 37.33 ms |
  | `^(.+)`, CJK + end | — | 31.25 ms | — |
  | Same frame without the surrogate (control) | — | 18.62 ms | — |

  Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-3/warm-all.txt`
- **I searched for frame classes the per-stage search did not record.** None is over 50 ms, and none exceeds the recorded class:
  - Surrogate in the middle of the cell: 34.65 ms.
  - Three lone surrogates per cell: 35.00 ms.
  - Intermediate row counts of 3,000, 7,000 and 12,000: 34.9-35.1 ms.
  - Bodies below or just above the excluded code points, all two-byte strings because of the surrogate:
    - `a`: 29.85 ms;
    - `é`: 29.92 ms;
    - `U+017F`: 35.05 ms.
  - `^(\S+)` on an ASCII body with one surrogate: 24.78 ms. This is in the band, and Group H covers it with Cyrillic and CJK, which are at least as slow.
  - `^(.*)$`: 10.45 ms.
  - Alternation or grouping variants (`^(..)|^(\d+)`, `^(?:(..))`) are rejected by the compiler (declined), so no admitted frame comes from them.
  - Inline flags (`(?i)`) are declined (`javaRegex.test.ts:57`).

  The anchor rule (`startAnchored`) is unchanged since round 2, and multiline `(?m)` is still declined.
- **Cold-process timing (a measurement-method check).** `cold.mjs` times the worst frame once, in a fresh node process, with no warm-up. That is closer to a first draft in a fresh tab than best-of-7 is. Results over three runs each:
  - 1,000 x 1,995 Cyrillic: 38.3-38.6 ms (decision about 24 ms plus exec about 14 ms).
  - 20,000 x 95 CJK: 41.5-42.7 ms.

  Both are under 50 ms. The "about 1.4x headroom" figure in `calibration.md` is a best-of-7 figure (the documented HEL-1697 method). Cold, the headroom is about 1.17x. The frames are the same and recorded; only the timing method differs, so this is not an unrecorded class of frames.

  Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-3/cold.txt`
- **Prose corrections (round-2 change request 2a) are present and accurate:**
  - the Verdicts bullet: 161 of 248 rows, worst 36.0 ms;
  - "Accepted risk (20-50 ms)" lists Group H and the pre-existing unanchored `(x)` rows at 25.2 ms;
  - the false sentence "no longer exist" is removed;
  - the round-1 "Change" paragraph is qualified to surrogate-free cells;
  - the headroom is restated as 1.4x;
  - lesson (2) is added to "What was missed";
  - a process note about C12's commit order is added.
- **The acceptance criteria still hold:**
  - AC1: the calibration tables, Groups A-H, are committed.
  - AC2: red first. `red-run.txt` was committed in `d3fb4618f`, before the implementation in `bd1c9412c`.
  - AC3: the unanchored HEL-1697 path is unchanged (`boundAt` with `anchored=false` is the old formula).
  - Owner ruling C2: no admitted frame is over 50 ms, warm or cold.

### Verdict: CONFIRM

### Non-blocking notes

- The PR body should give the headroom with its method: about 1.4x warm best-of-7, and about 1.17x for a single cold run (42.7 ms at worst). A slower browser V8 tier on that one shape (64-range class, two-byte cells with one lone surrogate, frame exactly at the budget) has less margin than 1.4x suggests.
- A follow-up could remove the shape with a model change, as in round 2's option 2b (a stage-2 `L` that adds one unit per surrogate). The owner accepted option 2a, so this does not block.
- Comments cite `archive/2026-11-21-...`. Confirm that the date matches the archive step.
