## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `d9c8f9a3d62c510ec402776d14cfbc8c066105f4` against the live-resolved base `6432e69e015fcde437d26262f15601fb59e069af`. Working tree: one uncommitted change, `design.md` +4 lines ("Owner ruling 2").

Evidence refs below are under `/home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/`.

### Evidence I produced myself
- **Gates (this worktree):** lint 0, format:check 0, typecheck 0, build 0, `npm test` 0 (579 + 9535 tests).
- **e2e at head (hel1665 + hel1678):**
  - CI-like browser (noble 1.55.1 + fonts-dejavu, Liberation kept): **94 passed**.
  - Host: **94 passed**.
  - DejaVu-only browser (band, 1440, data-before-font, measure, Serif and Mono cases): **44 passed**.
- **Owner condition 1 sweep at head (320-1300px, light and dark):** zero differing widths of 981 in both environments. Fallback faces were Liberation Sans and DejaVu Sans, the web face Schibsted Grotesk [custom] (`eval2-vsweep-ci.out`, `eval2-vsweep-dv.out`).
- **Owner ruling 2 verified:** `.concertino/runs/HEL-1737/events.jsonl` line 37 is `escalation.answered`, `answer: "accept-residual-with-followup"`, `answer_source: "human"`. It answers escalation `...c0bbed`, the question about the 605-613px data-first residual.

### The Serif "40ch" flake and the 10s poll (scrutinised as requested)
The executor's claim (measurements.md "Cycle 2" section and the comment at `e2e/hel1665-home-phone-stability.spec.ts:495-497`):
- About 1 read in 16 of the loaded Serif sentence's `40ch` returns 600px instead of 640px on the host, with the font set loaded, on the same element.
- Base's literal `40ch` cap was therefore "itself occasionally 600px in Serif".

My reproduction attempts, all at head CSS, Serif type style, 1280x900, the same seed/hold/release sequence as the test (`evalprobe/ch.spec.ts`, run through a scratch config that reuses the e2e harness):

| run | where | reads | 600px reads |
|--|--|--|--|
| probe x24, after the test's `fonts.status === "loaded"` wait; each read: settled cap, a `40ch` re-read, and a layout-based `width:40ch` block (exactly base's mechanism) | host | 1,440 | **0** |
| probe x2, alongside the full head spec (182 tests, 2 workers, load as in a normal run), plus 300 tight-loop reads per run taken BEFORE the status wait | host | 720 | **0** |
| probe x16, same as above, in the CI-like browser | CI-like | 5,760 | **0** |
| the cycle-1 version of the measure test (no status wait, no poll, a single read) x16 per theme | host | 32 serif runs | **0**, all `640.001/640` (`evalprobe-c1-host.txt`) |
| every serif `HEL1665-LONG` line in the executor's evidence and my runs | both | 46 lines | **0**, all `640.001/640` |

Conclusions:
- **The flake is not reproduced and has no raw evidence.** Over 7,900+ reads and 46 recorded serif test results, the `40ch` read and the layout-based 40ch block were always 640px. No artifact anywhere in the change dir, the run dir or the lane scratch contains a serif read of 600px.
- **The 10s poll waits on no settle signal.** The real settle signals are already in front of it: the CDP rendered-face precondition (line 470) and the `document.fonts.status === "loaded"` wait (line 477). The poll (lines 498-507) re-runs the identical synchronous read with nothing in between that could change state. That is retry-until-green, which is masking by construction.
  - It does not hide a regression in the product value: `settledMax` is a constant em, so a wrong em value would still fail after 10s.
  - It does hide the oracle misbehaving. It adds up to 10s of silent retry per case. It encodes an unproven Chromium behaviour into the test's comment as fact.
- **The base claim is not supported.** The layout-based `width:40ch` block is exactly base's cap mechanism, and it never read 600px in 7,920 samples. "Base's literal 40ch was itself occasionally 600px in Serif" (`evidence/measurements.md:92`) has no measurement behind it.
- The executor's earlier observation, "one host run in 94 ... while the serif face was mid-swap" (comment at lines 475-476), is plausible as a pre-settle read. The `fonts.status` wait is the correct, real fix for that, and I keep it.

### Phase 1: Spec Review — FAIL
- CR1, CR2 and CR4 from evaluation-1 are addressed:
  - The spec scenario no longer lists 610.
  - tasks 2.3 and 7.2 say the 610 data-first case was dropped.
  - D4 is updated.
  - The tokens moved to `theme.css`.
- **The artifacts state the owner-ruled residual dishonestly (stale).** The owner has ruled accept-residual-with-followup (Owner ruling 2), but three places still describe it as unruled or pending:
  - `design.md:160`: "**Open residual (not ruled on; escalated).**"
  - `specs/home-page/spec.md:83`: "This is escalated to the owner (HEL-1737) and is not asserted."
  - `tasks.md:17`: "Open residual, escalated to the owner".
  - `evidence/measurements.md` "Cycle 2" last bullet: "610 data-before-font is an open residual".
- **The owner ruling is not committed.** "Owner ruling 2" exists only as an uncommitted working-tree edit to `design.md` (`git status`: ` M design.md`). HEAD, which is what would merge, does not contain it.
- **`evidence/measurements.md:91-92` asserts an unmeasured base defect** ("base's literal `40ch` cap was itself occasionally 600px in Serif"). See the flake section.
- Otherwise the ticket's ACs are met as ruled, and C1 is honoured: the sweep shows zero differences in both environments; the 0px series and the HEL-1678 <=4px assertions are green; the new checks were red on base (cycle-1 evidence, unchanged).

### Phase 2: Code Review — FAIL
- **The retry poll in the measure test** (`e2e/hel1665-home-phone-stability.spec.ts:495-507`) masks rather than settles. See the flake section and CR1.
- Token move: compliant with DESIGN.md "Type styles".
  - `theme.css:273-292` adds a separate `:root` block and the serif/mono overrides as tokens.
  - `HomePage.css` has no `data-type-style` selector, and the guard `expect(css).not.toMatch(/data-type-style/)` is restored (`HomePage.css.test.ts`).
  - `overflow: hidden` now also applies to the Serif/Mono placeholder at >=605px. It is a hidden element, and the Serif/Mono 0px style cases pass in all three environments, so this is harmless.
- Everything else is unchanged from cycle 1 and sound.

### Phase 3: UI Review — PASS
- No change to the loaded rendering; executor pixel-diff evidence shows only the clock box differing.
- Every Home stability, band, desktop, Serif/Mono and large-font case passes in three font environments.
- The placeholder sweep is clean.
- Visual cohesion is left to the skeptic.

### Overall: FAIL

### Change Requests
1. `e2e/hel1665-home-phone-stability.spec.ts:495-507`: remove the 10s retry poll and its comment. Keep the `document.fonts.status === "loaded"` wait (line 477) and do a single `measure()` with the `<= 0.5` assertion, as before.
   - If the executor can produce a raw failing read (a serif `HEL1665-LONG` line or Playwright output with `ch40` 600 after the status wait), commit that output to `evidence/`, then replace the poll with a real settle signal. For example, `await page.evaluate(() => document.fonts.load('400 24px Fraunces', '0'))` before measuring.
   - Alternatively, use an oracle that does not depend on the flaky read: compare `settledMax` to the measured web 40ch constant for the style (640px at 24px Serif, 600 Sans, 560 Mono, x fontSize/24), or to a layout-measured `width:40ch` block.
   - A retry of the identical read is not acceptable.
2. `evidence/measurements.md:89-92`: delete or correct the flake bullet. Base's Serif `40ch` was not measured flaky. Record instead that the evaluator found 0 wrong reads in 7,920 samples (host and CI-like), and that the status wait is the settle signal.
3. Make the residual's owner ruling honest and committed:
   - Commit the "Owner ruling 2" paragraph in `design.md`.
   - Rewrite `design.md:160` ("Open residual (not ruled on; escalated)") to say it is accepted per Owner ruling 2, with a follow-up filed at Delivery.
   - Rewrite `specs/home-page/spec.md:83` ("This is escalated to the owner ... and is not asserted") to "Accepted by the owner as a known residual; tracked by a follow-up ticket; not asserted".
   - Make the same edit in `tasks.md:17` and the last "Cycle 2" bullet of `evidence/measurements.md`.
   - Re-run `openspec validate font-independent-home-sentence-cap --type change`.

### Non-blocking Suggestions
- `specs/home-page/spec.md:83` sits as a loose paragraph after the last scenario. Consider moving the residual note into the requirement body, before the scenarios, so a later spec sync does not attach it to the wrong scenario.
