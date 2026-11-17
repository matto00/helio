## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d952614285c9a75b23d8fd3c32ecb0375345450e. Base: 6432e69e015fcde437d26262f15601fb59e069af, resolved live with resolve-review-base.sh, exit 0.

Verdict: ESCALATION
Question: The ghost-nowrap rule adds a second 30px move at 605-613px when data arrives before the web font. The owner was not told this when accepting the data-first residual. Does the owner still accept the residual as it actually behaves?
Options: accept-double-shift-and-document, require-fix, halt
Context: Everything else checks out (see below). Owner ruling 2 (events.jsonl line 37) accepted the question as worded at line 32: "the REAL default sentence still reflows 30px". That wording, design.md "Open residual", and HEL-1748's description all read as base's behaviour carried over unchanged. It is not unchanged. In the CI-like (Liberation, i.e. Arial-metric) environment, the bottom of `.home-opening` in the data-first order goes through three states: placeholder, then the real sentence in the fallback face, then the real sentence in the web font.
  - Head: [127, 157, 127] at 605, 610 and 613, light and dark. That is two 30px moves: the nowrap placeholder is one line, the fallback sentence is two, the web-font sentence is one.
  - Base CSS (emulated by injecting base's `40ch` / `25em` / `white-space: normal`): [157, 157, 127]. That is one move.
  - So in this order, in this band and under Arial/Liberation metrics, head shifts layout twice where base shifted once. That is the ticket's own complaint ("605-613px is worse than before"), now limited to the data-first order.
  - The evaluator's probe (eval-realsentence.out) measured only the real sentence (web vs blocked). It never measured the placeholder-to-sentence transition. The `fontSwapSpread` metric is max minus min, so it reads 30 for both one and two moves. No gate could see this.
  - In the DejaVu-only environment the picture is mixed. Base already moved twice at 606-613 in data-first order, and head fixes those widths. 605 moves twice in both.
  - There is no fix inside the existing rulings. The only levers are the placeholder rule itself (which reopens the band ruling) or a change to the loaded rendering (HEL-1748's option). Choosing between them is the owner's product call, not mine.

### What I verified (with evidence)
- **Spawn-cwd guard:** READY.
- **Owner rulings:** both are present in /home/matt/Development/helio/.concertino/runs/HEL-1737/events.jsonl with answer_source "human":
  - line 22: ghost-nowrap-band;
  - line 37: accept-residual-with-followup.
- **Follow-ups:** HEL-1748 exists in Linear (Backlog). Its description frames the residual as one move back to one line. HEL-1749 is referenced in tasks 5.1.
- **Diff, read in full** (HomePage.css, theme.css, HomePage.css.test.ts, homeLoadProbe.ts):
  - The em measure per type style is a theme.css token, so HomePage.css has no data-type-style selector.
  - The nowrap applies only to the hidden ghost, Sans only, from 37.8125em.
  - The real sentence is untouched.
  - A minor nit: a stale duplicate comment block sits above `.home-opening__sentence`.
- **AC 1, cold-load (fonts-first) swap.** I ran my own probe in a fresh helio1678-ci container, with faces proven by CDP getPlatformFontsForNode (pre-swap Liberation Sans, then Schibsted Grotesk).
  - Head, light and dark: 0px at 604, 605, 606, 608, 610, 612, 613, 620, 1024, 1280 and 1440.
  - Desktop data-first: 0px.
  - Base emulation: 30px in the band (fonts-first) and 30px desktop data-first. The new checks are therefore red on base.
  - DejaVu-only container (helio1678-dv, CDP shows DejaVu Sans): head fonts-first is 0px at 604-610 and 1280.
  - Refs: /home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/skeptic-final/cold-head-ci.out, cold2-ci.out, cold3-dv.out, cold2.cjs
- **C1 sweep blind spot, which I checked separately.**
  - The executor's vsweep2 compares the ghost against the ghost (web vs fallback). Above 605px both are nowrap, so in the band it is tautological.
  - I ran the missing comparison on the host with the web font loaded: the shipped nowrap ghost against the same ghost with `white-space: normal` (the web-font wrap), for every width 320-1300, in Sans, Serif and Mono.
  - Result: 0 mismatches, and no clipped overflow. The `.home-opening` content box never drops below 581px at widths of 605 and up, sidebar included. The nowrap therefore never hides a web-font second line.
- **AC 2 (0px series and the hel1678 <=4px assertion green):** I relied on the evaluator's pasted runner output, which is unambiguous: eval3-e2e-ci.txt 94 passed, eval3-e2e-host.txt 94 passed, eval3-e2e-dv.txt 44 passed.
- **Visual cohesion, settled with web fonts, head vs base CSS, light and dark:**
  - The sentence rectangle and the `.home-opening` screenshot bytes are identical at 375, 604, 610, 1024 and 1280 Sans, and at 1280 Serif.
  - At 1280 Mono the rectangle is 559.984 vs 560 and the screenshot is still byte-identical.
  - I viewed dark-610-sans-head.png.
  - Ref: /home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/skeptic-final-shots/dark-610-sans-head.png

### Gate defect
None found regarding mtimes. One gate gap: the C1 condition-1 sweep, as executed, cannot detect a ghost-vs-loaded-sentence divergence above 605px. My separate sweep above covers it.

### Non-blocking notes
- HomePage.css: two adjacent comment blocks above `.home-opening__sentence`. The old "The real sentence's measure..." block could be merged into the new one.
- If the owner accepts: correct design.md "Open residual", the spec's "Known accepted residual", the PR body and HEL-1748 so they state the data-first band behaviour as two moves, one of them introduced by this change.
