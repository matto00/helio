## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `6d9e955402c4c09878b5f95799878786ce33d141` against the live base `beb94adfe49759ebc8e180500130a032fdfac3b4`.
New in this cycle: commit 6d9e95540 (first-sample instrumentation in `settleToRest`, plus a note on the guard) and the
evidence `root-cause.md`, `instrumented-local-run.log`, `stability-leg2-pass{2,3}-batch{A,B}.log` and `ci-pr1191-e2e2.log`.

### Phase 1: Spec Review — FAIL

Cycle 1 change requests:
- **CR1 (root-cause write-up): mostly done, but it contains one false figure and one claim with no evidence (Issue 1).**
  Verified as accurate:
  - The hel1783 claim is now withdrawn, with the correct direction: hel1783 started during the dark test in all three
    failing runs.
  - (a) is stated plainly as "NOT explained by a probed discriminator", with the theme-independence evidence (red guard
    dark 4/5, light 5/5).
  - (c) is stated as not reconciled. The "faster runner fails vs stall model" tension is acknowledged, and the
    phase-relationship idea is labelled as a hypothesis.
  - The write-up says the orchestrator decides whether this meets Decision 1, which is the correct split of
    authority. My assessment, as facts: (b) is explained with evidence. (a) and (c) are not explained, and the
    write-up says so. The fix does not depend on (a) or (c), because it waits for a provable rest state for both
    themes and all six instances.
  - The CI confirmation section is accurate. I checked it against `ci-pr1191-e2e2.log` and `gh run view 44685378992`:
    - Run conclusion: `success`.
    - headSha `6d9e955402c4...`; the checkout is "Merge 6d9e955402c4... ".
    - Job 136118335545 `e2e (2)`: success, "131 passed (14.2m)".
    - Desktop dark 26.7 s, light 27.4 s.
    - All 12 `HEL-1790 ... rest waited=` lines read 0 ms, except light instance 1 at 1 ms. All show
      hovered/inside/running false, and the light Select trigger's border is `rgba(33, 29, 25, 0.11)`.
  - The write-up's reading of that CI result is honest: the run neither confirms nor refutes the natural trigger on a
    real runner.
- **CR2 (task 3.1): done.**
  - Three full leg-2 passes, all green:

    | Pass | Batch A | Batch B |
    |------|---------|---------|
    | 1 | 73 | 49 |
    | 2 | 73 | 47 |
    | 3 | 73 | 47 |

  - Pass 1's batch B is 2 larger only because it also ran `hel1790-hover-probe.spec.ts` (that spec file is the only
    difference). 73 + 47 = 120 matches the CI leg's 119 passed + 1 failed.
  - Each pass runs both desktop hover tests.
  - It is three runs, not literally `--repeat-each=3`, but it meets the intent of 3.1.

Issues:
1. **`root-cause.md` (b) overstates the natural evidence.** It says "hoverFrames > 0 in ~12/40 reps" in
   `probe-natural-hog90-40reps.log`. The log has 40 reps (all light). The counts are 35 at `hoverFrames=0`, 3 at
   `hoverFrames=2` and 2 at `hoverFrames=4`, so **5/40**, not ~12/40. The same file's 5 `:H:` lines agree. The same
   bullet also says "unloaded runs: 0". No evidence file or scratch log contains an unloaded probe run, so that figure
   is uncited. The qualitative claim still holds: the trigger turns `:hover` mid-slide with no mouse move under a
   90 ms main-thread hog. But this document is what the orchestrator will use to rule on Decision 1, and its natural-rate
   figures must match the logs.

### Phase 2: Code Review — PASS

Fresh gates, run by me:
- eslint `--max-warnings=0`, prettier `--check` and `tsc -p e2e/tsconfig.json` on the 3 e2e files: all exit 0.
- Lane servers (`helio_hel1790`, 7222/10129, `ANTHROPIC_API_KEY` empty, 2 workers, nice 19): `hel1675-shared-hover`
  plus the guard spec, `--repeat-each=2`, **12/12 passed**. Servers were stopped afterwards. Log:
  `/home/matt/Development/helio/.concertino/runs/HEL-1790/evidence/.concertino/scratch/HEL-1790/eval2-run.log`.

Is the instrumentation sound? Yes, for the question it is meant to answer:
- `settleToRest` is called exactly where the old `paint(control)` rest read was: immediately after `inst.open` and
  `inst.control` (`e2e/hel1675-shared-hover.spec.ts:373`).
- `tick()` runs synchronously inside that same `evaluate`, so `first` is sampled at the moment the old read took its
  sample.
- `first.border` is the trigger's own computed `borderTopColor`, the property the CI operand differed on, so any hover
  paint the old read would have returned shows there directly.
- `hovered` and `inside` are element-specific.
- Assertions are still unchanged: `not.toEqual(rest)` for all six instances, and `toEqual(DESKTOP_HOVER[theme])`.

Non-blocking gaps in the instrumentation:
- `running` and `props` are document-wide (`document.getAnimations()`), not the trigger's own. My run shows why this
  matters: dark instance 3 logged `rest waited=155ms first={"hovered":false,"inside":false,"running":true,"props":
  ["border-bottom-color",...,"color"],"border":"rgba(242, 239, 233, 0.09)"}`. Some element had a border/colour
  transition running at the old read point, the trigger's border was still at rest, and the log cannot say whether the
  animating element was the trigger. That ambiguity is exactly what the next CI diagnosis would need to resolve.
- The fallback `a.id ?? "anim"` never takes effect: an unnamed animation's `id` is `""`, not null or undefined.

### Phase 3: UI Review — N/A

No trigger matched: there are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: FAIL

Category: spec-divergence (the evidence the root-cause statement cites does not match it). The code, assertions,
stability counts and CI result all verify. The only blocker is a narrow correction to `root-cause.md`.

### Change Requests
1. In `/home/matt/Development/helio/.concertino/runs/HEL-1790/evidence/root-cause.md`, section (b), third bullet:
   - Change "hoverFrames > 0 in ~12/40 reps" to "hoverFrames > 0 in 5/40 reps (3 x 2 frames, 2 x 4 frames), all light".
   - Either cite a persisted log for "unloaded runs: 0" (the rep count and the file) or delete that clause.
   - This is a documentation fix only, with no code change. The orchestrator may make it directly, since it already
     co-authors this file.

### Non-blocking Suggestions
- In `settle`, record `el.getAnimations()` (the trigger's own transitions) in `first`, alongside or instead of the
  document-wide `props`. Then a future CI line can say whether the trigger itself was mid-transition. This is the
  ambiguity my dark instance-3 sample shows (above).
- Replace `a.id ?? "anim"` with `a.id || "anim"`.
- `proposal.md`, `design.md`, `ticket.md`, the `skeptic-design-*.md` files and `evaluation-*.md` are still untracked in
  the worktree. Commit or archive them at Delivery.
