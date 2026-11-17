## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/home-sentence-font-independent-cap/HEL-1737`. HEAD is `6432e69e015fcde437d26262f15601fb59e069af`. The only untracked path is the change dir.
- Round-2 CR1 (two-sided PASS) is addressed. design.md D3 and tasks.md 1.3 now require the fallback ghost to be one line at 605 and two at 604, exactly as the web font does, measured directly rather than inferred from widths.
- Round-2 CR2 (full sweep) is addressed. D3 and 1.3 require a 320-1300px every-width sweep of ghost line count and height, fallback versus web font, with zero differing widths. Task 3.3a repeats it on the final head.
- Round-2 CR3 (spec rewrite on the FAIL path) is addressed by task 1.5. It sits before 1.4 in the file; the numbering is out of order but the meaning is clear.
- Ground truth re-checked:
  - `HomePage.css` l.28-30: the sentence is capped at `40ch`. l.49-57: the ghost is capped at `25em`. Both use `--font-heading`, `--text-2xl` and `letter-spacing: -0.01em`.
  - `theme.css` l.21-75: two fallback faces per web face. Sans uses `... Fallback Arial` at 104.94% and `... Fallback DejaVu` at 91.42%. `:root[data-type-style="serif"|"mono"]` (l.265-270) re-point `--font-heading`/`--font-sans`. So a sentence-local font stack limited to the Sans style is expressible in CSS, and D3's mechanism is feasible as written.
  - The web fonts come from Google Fonts (`frontend/index.html` l.59-75), so D4's plan to route the Google Fonts CSS/woff2 requests matches reality.
  - The restated measure test (`e2e/hel1665-home-phone-stability.spec.ts` l.416-465) computes `40ch` in-page and compares it with the settled `maxWidth`. D4's restatement (em cap equals the web font's 40ch within 0.5px) is concrete. It also gives an indirect check that the web font actually loaded.
- D1 is sound. An em measure equal to the web font's 40ch, set per style, leaves a settled Home with the web fonts loaded identical within 0.5px. At <=430px the cap does not bind, since the content box is about 351px.
- HEL-1678 archive, `measurements.md` l.5 and l.11: that lane exercised the DejaVu-matched face only in a separate `head-dv` environment, "same image with `fonts-liberation` removed". In the CI-like image, Liberation is present and the Arial-matched face renders. The DejaVu-matched face never renders there.

### Verdict: REFUTE

One narrow defect remains. The plan requires the DejaVu-matched opening face to be validated, and the spec makes the DejaVu-only fallback a SHALL. But no task names the environment where that face actually renders.

### Change Requests

1. **Name the DejaVu-only environment for the DejaVu-matched face. Change tasks.md 1.1, 1.3, 3.3a and 3.3, and design.md D3.**
   - The gap: tasks 1.3 and 3.3a say to sweep "each Sans fallback face (Liberation-matched and DejaVu-matched)" "in the CI-like container". In that container Liberation Sans is installed, so `Schibsted Grotesk Fallback Arial` (and D3's `... Arial Opening`) wins. A DejaVu-matched sweep run there measures the Liberation face a second time and reports a vacuous PASS. This is the exact trap HEL-1678's design-1 skeptic flagged.
   - The spec delta's "Cold-load web-font swap is bounded" scenario now lists 605 to 613 and 1440 "under the CI-like font set ... or with DejaVu as the only fallback". Task 3.3 runs only "in the CI-like browser and on host". So nothing verifies the DejaVu-only half of that SHALL at the new widths.
   - Required changes:
     - Add the HEL-1678 `head-dv` environment (the same noble image with `fonts-liberation` removed) to task 1.1.
     - In 1.3 and 3.3a, require the DejaVu-matched size-adjust sweep and the 320-1300px sweep to run there. Prove the face with CDP `getPlatformFontsForNode`: it must report DejaVu Sans.
     - In task 3.3, add a DejaVu-only run of the new band and 1440 cold-load cases, light and dark.
     - Alternatively, if the DejaVu-only case is meant to be out of scope for the new widths, drop "or with DejaVu as the only fallback" for 605-613 and 1440 from the spec delta and say so in design.md Non-Goals. Do not leave a SHALL with no task behind it.

### Non-blocking notes

- New swap and data-before-font cases can pass vacuously if the web font never arrives (for example, Google Fonts unreachable on CI), because the timeline then never moves. D4 already records the pre-swap platform font. Also assert that the held font route was hit and released, and that after release the sentence's platform font is the web face (CDP, or `document.fonts.check('400 24px "Schibsted Grotesk"')`). That way a green result proves a swap happened.
- Renumber tasks 1.4 and 1.5 so they read in execution order.
- The visual check (4.1) lists 602px. Once D3 lands, keep a 604px shot as well: that is the exact wrap boundary.
