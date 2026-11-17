## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: 0390d7b718626c2d8375bb4381360ce75c0615ff. Base: 6432e69e015fcde437d26262f15601fb59e069af, resolved live with resolve-review-base.sh (main/origin), exit 0.

### What I verified (with evidence)

- **Spawn-cwd guard:** READY (ambient /home/matt/Development/helio, branch matches).
- **Owner rulings:** /home/matt/Development/helio/.concertino/runs/HEL-1737/events.jsonl, lines 22, 37 and 60. All three are `escalation.answered` with `answer_source: "human"`: ghost-nowrap-band, accept-residual-with-followup and accept-double-shift-and-document. No later event changes them.
- **Code is unchanged since round 2 except one comment.** `git diff 4c5fa923d HEAD -- frontend e2e` shows only HomePage.css, and only its comment lines: two adjacent comment blocks above `.home-opening__sentence` were merged into one, with the same content. `max-width: var(--home-sentence-measure)` and every other rule are byte-identical. e2e has no diff. Round 2's results therefore still apply to the code:
  - the AC tracing;
  - the evaluator's pasted 94/94/44 e2e output;
  - the 320-1300px ghost-vs-sentence sweep (0 differences);
  - the settled screenshots.
  This also closes round 2's non-blocking nit (the two comment blocks).
- **Gates re-run on HEAD:**
  - jest for `HomePage.css` and `appearanceTokens`, maxWorkers 3: 35/35 pass.
  - `openspec validate font-independent-home-sentence-cap --type change`: valid.
  - Prettier reports the three edited markdown files only when run with frontend's config. The root `.prettierignore` excludes `openspec`, so the repo's `format:check` does not flag them.
- **CR1, spec.md:83: fixed.** It now says:
  - DejaVu 606-613: the change does not move it (0px), where base moved it twice.
  - DejaVu 605: the change moves it twice, where base moved once (the placeholder rule adds the first move).
  - The Liberation sentences are unchanged and correct.
- **CR2, design.md "Owner ruling 3": fixed** with the same wording.
- **CR3, Linear HEL-1748 (fetched live, updatedAt 2026-11-17T20:08Z):**
  - The bullets are per face and match the measurements.
  - The "Why" paragraph now says the DejaVu face wraps only at 605, because the content box is at least 582px from 606px up.
- **CR4, measurements.md:** both bullets now point to design.md "Owner ruling 3" as the current per-face description and drop the single-30px-swap wording.
- **The new text matches the raw measurements.** I checked it against the raw CDP-proven output, not the prior report's summary:
  - Source: /home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/skeptic-final-2/dv-datafirst.out.
  - Faces: pre and mid = DejaVu Sans, post = Schibsted Grotesk.
  - Head, light and dark: 605 [127,157,127]; 606/608/610/612/613 [127,127,127].
  - Base, light and dark: 605 [157,157,127]; 606-613 [127,157,127].
  - One anomaly: base dark 613 shows post=DejaVu, meaning the web font had not loaded in that sample. It is a single reading in the base column, the round-1 run corroborates the other values, and it does not touch any claim in the corrected text.
  - The code under test is identical, so no re-measurement was needed.
- **Mtimes:** no mtime-ordering claims are relied on. No gate defect.

### Verdict: CONFIRM

All four round-2 change requests are fixed and accurate against the raw measurements. The only code change since round 2 is a comment merge. The ACs and the owner ship conditions (C1) still stand as verified in rounds 1-2.

### Non-blocking notes
- HEL-1748's "Residual." lead sentence still says, in general terms, that the sentence "renders in the fallback face on two lines". The per-face bullets directly below qualify this (DejaVu 606-613 does not wrap). A one-word "can" would make the lead exact.
- The PR body must use the per-face wording from design.md "Owner ruling 3". It does not exist yet, so I could not check it.
