## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD d3059b6114f7735e210a4a1675737585d8dae5c8 (planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/anchored-regex-surrogate-bound/HEL-1823`.
- **Artifacts present:** ticket.md, proposal.md, design.md, tasks.md, `.openspec.yaml` (`skip_specs: true`). There are no TODO or TBD
  markers and nothing deferred that blocks implementation. D2 leaves the counting method open on purpose: it is to be picked by
  measurement, with a stated escalate-rather-than-ship rule.
- **(1) Is the unit-count identity right, and is the bound sound?** I checked this against `regexInputCost.ts` on main.
  - The identity holds. `anchoredCellWork` (lines 82-98) adds `units = pair ? 2 : lone ? LONE_SURROGATE_UNITS : 1` per code
    point. A pair is 2 UTF-16 units, a lone surrogate is 1 UTF-16 unit, and every other code point is 1 unit. So
    `len = text.length + (LONE_SURROGATE_UNITS - 1) x loneCount`.
  - "Lone" means the same thing in both places. `codePointAt` iteration with a step of 2 on a pair flags exactly the
    ill-formed units. A `/u` global regex `[\ud800-\udfff]` matches exactly those units too, because under `u` a well-formed
    pair is one code point.
  - The bound is sound. With `L` exact, `boundAt(work, L) = f x min(A L + L A min(L,W) + m L^2, A(1+W) + L(A+m))`. Runs sum to
    at most `L`, so `sum R min(R,W) <= L min(L,W)` and `sum R^2 <= L^2`. That gives perPositionBound >= exact per-position
    charge, and `R0 <= L` gives the attempt bound >= exact attempt. Therefore `min >= min`.
  - The early-return branch (line 93, which returns `attempt` when `attempt <= f A text.length`) is also dominated: there
    `attempt <= f A text.length <= f x perPositionBound`, and `attempt <= f(A(1+W)+L(A+m))`.
  - So each stage is still an upper bound, stage 3 still decides, and the decision is identical for every frame. That covers
    every HEL-1697 and HEL-1807 shape (the second AC), not just the calibration rows.
  - The group-H worst shape is equal at stage 2. The calibration row `^([^<64 ranges>]*)` on CJK + `\ud800` at 1,000 x 1,997
    costs 4.000e6, i.e. 4,000 per cell = `2 x (2 + R0)`, so `R0 = 1,998` units. That is the 1,997 UTF-16 units plus one for the
    lone surrogate, so the lone surrogate is inside the run (the negated class contains it). The bound with exact `L = 1,998`
    gives `f(2 + L) = 4,000`, equal to the exact charge, so stage 2 admits it. On main, stage 2 uses `L = 3,994` → 7,992 per
    cell → it misses and stage 3 scans. The design's claim checks out.
- **(2) Is D2 adequate?**
  - Keeping `LONE_SURROGATE.test` as the gate keeps today's path for surrogate-free cells. The three candidate counters are
    reasonable, and the dense rows (2, 16, half, all) cover the per-match-overhead risk of an `exec` loop.
  - The baseline reasoning is correct. On main an all-lone cell already hits stage 2 (`2 x len` is exact). A half-lone cell
    misses stage 2 on main and scans, so the only regression risk is the counting cost itself, and that is what D2 measures.
  - The escalate rule covers the borderline case (see note 4).
- **(3) Is D3's failing-first test genuinely red on main, and deterministic?**
  - The established seam already exists: `countReads` at `regexInputCost.test.ts:180-188`, with a precedent test asserting
    zero reads at :198-207.
  - On main the group-H frame fails stages 1 and 2 and runs stage 3, which calls `codePointAt` about 2e6
    times. So `expect(reads).toBe(0)` is red on main and green after the fix.
  - The decision `false` holds on both (`1000 x 4000 = 4.0e6`, not `> 4.0e6`). It is integer arithmetic with no timing, so the
    test is deterministic.
- **(4) Is skip_specs justified?** Yes. `openspec/specs/pipeline-client-evaluator/spec.md:132` states the 20/50 ms rule and
  the anchored charge. It never mentions surrogates or lists the accepted-risk shapes. The change alters no SHALL; only
  calibration evidence moves.
- **Scope against the ACs:**
  - AC1 is covered by D3 plus D4/3.2. The AC accepts "measured under 20 ms", and the mechanism is pinned by a deterministic test.
  - AC2 is covered by the soundness argument plus D4's decision-identity check.
  - AC3 is covered by D5/3.3.
  - `REGEX_WORK_BUDGET`, the parity corpus and the cost formula are untouched (non-goals). No pattern costs more, because the
    charge (`cellWork`) is unchanged.
- **Tasks against the design:** they are consistent. Red-first ordering (1.x before 2.x) follows C12.

### Verdict: CONFIRM

### Non-blocking notes

1. **The "count pairs as lone" mutation (D3, task 1.2) will survive the tests as specified.** Over-counting only loosens the
   bound, so the soundness property test and the decision-equality test stay green. The named group-H cell is CJK (BMP only),
   so the zero-reads/equality test has no pair to over-count. To make the mutation red, the zero-reads (or bound == cellWork)
   assertion must also run on a cell holding surrogate pairs plus one lone surrogate. Group H's astral body
   (`\u{1F600}` x n + one lone) does this.
2. **The property test needs a pattern whose class contains surrogates.** Undercount mutations ("drop the `- 1`", "count only
   the first lone") only push the bound below `cellWork` when the lone surrogates sit inside the run. Use, for example, `^(.+)`,
   `^(.*)x` or a negated class, not only `\d`-style classes.
3. **Prefer the `countReads` zero-reads seam over exporting `testedBound` for the red run.** A missing export makes the file
   fail to compile or import on main (red for the wrong reason). A zero-reads assertion is red on the behaviour itself.
4. **The timing headroom is thin.** Group G (uniform cells, where stage 2 already decides) measured 18.6-19.1 ms, with one
   20.25 ms run. The fixed group-H rows will cost about that plus the counting pass, so landing just under 20 ms is plausible,
   not certain. The D2 escalate rule and the AC's "or declined" branch cover this. Report best-of-N and a rerun per the design.
5. **Size the D3 frame from `cellWork`, not from a copied number.** The archived calibration names the worst row both
   1000x1997 (table) and 1000x1995 (WORST line). Size it so the exact sum is exactly 4.000e6, and also assert that one more
   character is DECLINED, as the :198-207 precedent does.
