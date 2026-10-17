## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `2f0900b8fd8de528dd5af913b553e0b38e219c75` (cycle diff `23aec7256..HEAD`, full diff base
`29b39995a`). The evidence I produced for this cycle is `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/eval3-*`.
I used no isolated DB, only throwaway users on the worktree's own servers (7005/9912).

### Gates (my own fresh runs, in WORKTREE_PATH)

| gate | result |
| --- | --- |
| lint / format:check / typecheck | PASS / PASS / PASS |
| `npm test` (2 workers, nice 19) | PASS: 7665 tests |
| `npm --prefix frontend run build` | PASS |
| e2e: `hel1573-motion-primitives`, `hel1573-motion-grid-chart`, `hel1574-shell-rail`, `hel1572-appearance-preferences` | PASS 44/44 in 2.7 min (`eval3-e2e-affected.txt`) |

### Cycle 2 change request: done

`useIndicatorSlide.measure()` now does three things in order:
1. Reads all four offsets.
2. Decides whether to snap and, if so, sets `data-indicator="snap"`.
3. Only then writes the `--indicator-*` properties.

The new real-browser test clicks Full → Subtle in the Motion group and samples every frame in the same task. It
went red under the old write-then-read order (62 px off at frame 2, executor `red-C3-motion-group-write-then-read.txt`).
That is the same 221→283 slide I measured in cycle 2. In my own run it passes. The indicator is at its final
position (283) from the first frame, with no running transition (`eval3-motion-group-indicator.json`).

The Full slides are intact: in the same run, the Full tests still assert the rail and segmented indicators
transition at 280 ms on the ease-out curve.

### The recorder fallback: does it keep the assertions honest?

**It cannot invent an entrance.** The fallback runs only inside a real `animationstart` event, and only for an
`animation-name` that is computed on the target. If an animation is missing, there is no event and therefore no
record. My stagger-removed mutant under Full got 0 records and went red at "≥5".

**Its `moves` is inferred, so it can be wrong in exactly one case.** The fallback reads `moves` from the rise token,
not from the keyframes. A keyframe-level regression would be misreported only on records that came through the
fallback. Two ways that could happen:
- Full: the rise is dropped from the keyframes while the token stays 6px. The record would claim it moves.
- Subtle: a literal translate is added to the keyframes while the token is 0px. The record would claim it does not.

**In practice the fallback never feeds Full or Subtle.** In my 44-test run every Full and Subtle `motion-enter`
record came through the real `getAnimations()` path: 0 of 20 used the fallback. Only Off and OS-reduce used it, for
their 0.01 ms entrances, and there `moves=false` is correct because the rise token is 0px.

**Off and OS-reduce do not depend on `moves`.** Their "no primitive animation longer than 0.01ms" check uses
duration alone. A slow injected animation is still running when its event is handled, so it goes through the real
path.

**The mutants, run on the cycle-3 spec, all fail where they should:**

| mutant | mode | failed at |
| --- | --- | --- |
| rise dropped from keyframes, fade kept | Full | red at `every(moves && 280ms)` |
| stagger removed | Full | red at "stagger entrances recorded ≥5, received 0" |
| literal 6px translate in keyframes | Subtle | red at `subtle/light/load: moving animations` |
| 280 ms stagger with rise (beats the global `!important`) | Off | red at `off/light/load: moving animations` |
| no mutant (control) | Full | passed |

Logs: `eval3-*.txt`.

Verdict: the assertions are honest as run. The leftover risk is a false green only if every Full or Subtle record
fell back under extreme load *and* the keyframes regressed at the same time. That is non-blocking; see the
suggestion below.

**Stagger delay progression.** The new assertion is that delays are `[0, 40, 80, 120, 160]` and ≤400 ms. It held
in my run, and it went red with the delay removed (executor `red-C3-stagger-delay.txt`). The "≥5" threshold is
restored, and in my run all Full and Subtle tests recorded 5 of 5 rows.

### Phase 1: Spec Review — PASS

- All five ACs are met.
- AC2 is verified in a real browser in both themes, with demonstrated reds (cycles 1–3).
- AC5 is proven through the applied-option and series-type-change cases.
- The Indicator slide requirement now holds for the Motion control itself.
- Constraints C1 and C2 hold.
- Only CSS changed under `grid/` (HEL-1575).
- There is one motion reader.
- Planning artifacts match the code.

### Phase 2: Code Review — PASS

The cycle diff is small and correct. The recorder code is typed and commented.

### Phase 3: UI Review — PASS

Every item checked in cycles 1 and 2 still holds, and the one cycle-2 defect is fixed and proven in a browser.

### Overall: PASS

### Non-blocking Suggestions

- Tag fallback records in `e2e/support/motionRecorder.ts` (for example `inferred: true`). Then make the Full and
  Subtle `motion-enter` assertions require at least one non-inferred record, so a keyframe regression cannot be
  masked even when every record falls back under extreme load.
