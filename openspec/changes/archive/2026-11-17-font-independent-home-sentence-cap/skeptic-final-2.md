## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 4c5fa923dec882a0f879170c07d17e7cdc818426. Base: 6432e69e015fcde437d26262f15601fb59e069af, resolved live with resolve-review-base.sh (main/origin), exit 0.

### What I verified (with evidence)

- **Spawn-cwd guard:** READY (ambient /home/matt/Development/helio, branch matches).
- **Owner rulings** in /home/matt/Development/helio/.concertino/runs/HEL-1737/events.jsonl, all `answer_source: "human"`:
  - line 22: ghost-nowrap-band;
  - line 37: accept-residual-with-followup;
  - line 60: accept-double-shift-and-document. This is the latest `escalation.answered`, and no event after it changes it.
  - The question it answers (line 58) described only the CI-like (Liberation) case.
- **Since round 1, code is unchanged.**
  - `git diff d95261428 HEAD` touches only design.md (+10) and specs/home-page/spec.md (1 line).
  - The frontend/e2e diff against round 1's reviewed SHA is empty.
  - So round 1's results still apply: the full diff reading, the AC tracing, the evaluator's pasted e2e output (94/94/44), and the byte-identical settled screenshots (light and dark).
  - I re-ran jest for HomePage.css.test.ts and appearanceTokens: 35/35 pass.
- **Ghost vs. loaded sentence, every width 320-1300** (host, web font loaded, Sans, light and dark).
  - Method: the shipped hidden placeholder's height compared with the real sentence's height when it carries the default text.
  - Result: 0 differing widths in both themes.
  - The desktop content box is at least 665px at 769px, so the unbounded `min-width: 37.8125em` nowrap never hides a web-font second line.
  - Ref: .../skeptic-final-2/sweep.cjs (output in this session; samples 604 = 2 lines/2 lines, 605-1280 = 1 line/1 line).
- **The accepted residual, re-measured in data-first order.** CDP getPlatformFontsForNode proves the faces at every width: before = fallback, during = fallback, after = Schibsted Grotesk. The tool is round 1's cold2.cjs, extended to 605/606/608/610/612/613 in both themes. Base = base CSS injected (`40ch` sentence, `25em` placeholder, `white-space: normal`). The values are `.home-opening` bottom in px for placeholder, then fallback sentence, then web-font sentence.
  - **CI-like container (Liberation Sans), light and dark, all six widths:**
    - head [127,157,127], two moves;
    - base [157,157,127], one move.
    - This matches the spec, design.md and HEL-1748.
    - Ref: /home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/skeptic-final-2/ci-datafirst.out
  - **DejaVu-only container (DejaVu Sans), light and dark:**
    - head at 606-613: [127,127,127], **zero moves** (0px);
    - head at 605: [127,157,127], two moves;
    - base at 606-613: [127,157,127], two moves;
    - base at 605: [157,157,127], **one move**.
    - Ref: /home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/skeptic-final-2/dv-datafirst.out
  - The DejaVu numbers are stable. The round-1 skeptic's own independent run (cold3-dv.out, persisted) shows the same: head 606/610 [127,127,127], and base 605 light [157,157,127].
  - This also follows from the measured widths. The DejaVu-matched sentence is 581.05px. At 606px and up the content box is at least 582px, so in head the fallback sentence fits on one line under the 25em cap. In base, `40ch` in the fallback was 560px, so it wrapped. At 605px (581px box) the base placeholder already wraps.
  - The arithmetic, the DejaVu-only fallback, and the 605 vs 606+ split are the parts this report adds.
- **Visual check.** I viewed the settled Home at 1280 dark and 610 light (home-dark-1280.png, home-light-610.png, persisted under the same skeptic-final-2 ref dir). The sentence is one line, the spacing rhythm is unchanged, and nothing is off-pattern.
- **Containers.** The helio1678-dv and helio1678-ci containers I started (--rm) were stopped by exact id. None remain.
- **Gate defect:** none regarding mtimes.

### Verdict: REFUTE

The code ships as far as the ACs and the owner rulings go. The one remaining defect is the one this round was asked to check: the residual's description is wrong for the DejaVu-matched face.
- The spec, design.md and HEL-1748 say that head moves **once** at 606-613 and that **both** move twice at 605.
- Ground truth, reproduced twice in two independent runs, is different: head moves **zero** times at 606-613, and base moved **once** at 605. So at 605 this change also adds a move under DejaVu, which is the same mechanism as the Liberation case the owner accepted.
- The error appears to come from round 1's prose summary ("605 moves twice in both"), which contradicts round 1's own raw output.

### Change Requests

1. `openspec/changes/font-independent-home-sentence-cap/specs/home-page/spec.md:83` ("Known accepted residual"): replace the DejaVu sentences with what was measured.
   - "DejaVu-matched face (DejaVu only), 606-613px: the change does not move it (0px) where base moved it twice (placeholder one line, fallback sentence two lines, web-font sentence one line)."
   - "At 605px the change moves it twice where base moved once (the placeholder rule adds the first move, as in the Liberation case)."
   - Keep the Liberation sentences, which are correct.
2. `openspec/changes/font-independent-home-sentence-cap/design.md:178-180` ("Owner ruling 3"): make the same correction.
3. Linear HEL-1748:
   - Correct the DejaVu bullet (606-613: 0 moves after HEL-1737, base twice) and the "605px: both move twice" bullet (HEL-1737 twice, base once).
   - Fix the "Why" paragraph. It implies that the DejaVu-matched fallback wraps across 605-613. It wraps only at 605, where 581.05px > 581px; from 606px up the box is at least 582px.
   - Use `save_issue` with `patch`. Do not resend the full description.
4. `openspec/changes/font-independent-home-sentence-cap/evidence/measurements.md`: in the "Not covered by the ruling" bullet and the last Cycle 2 bullet, either add a pointer to design.md "Owner ruling 3" as the current per-face description, or restate it per face. Both bullets describe a single 30px swap and do not distinguish faces. The PR body must use the corrected per-face text as well.

### Non-blocking notes
- HomePage.css still has two adjacent comment blocks above `.home-opening__sentence` (the round-1 nit).
- A DejaVu-at-605 data-first test is not asserted. That is consistent with the owner ruling.
