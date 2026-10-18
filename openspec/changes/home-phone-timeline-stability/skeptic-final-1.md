## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 02e201436d33a5ab5cdbb8b09d7984c53a60775b against the live-resolved base 6477341111d4b4ec6d0368e5a1f46e473325f226
(`resolve-review-base.sh`, exit 0). The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

- **AC1 red on base, using the current HEAD spec (my own run, not the executor's earlier spec versions).** I exported
  the base `frontend/` (git archive 647734111) into my scratchpad and served it on 7097 against the live 10004
  backend. I could not use another port because the backend's CORS allowlist is fixed at 7097. The HEAD frontend was
  restored afterwards with `start-servers.sh`, and `assert-phase servers` returned PASS. I then ran the HEAD
  `hel1665` spec (`-g "Home load \(|Home settled"`, 2 workers, nice 19, under the flock):
  - Result: **25 failed, 2 passed**. All 24 shift tests fail on `runs card top`. The measured spreads are 61px at
    375/430, 71px at 480/540 and 11px at 1280, in both themes and both orders. The bound test also fails.
  - The two C1 pinned-desktop tests **pass on base**. That confirms the PINNED numbers really are base numbers.
  - Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final/red-head-spec-on-base.txt`.
  - My first attempt on port 7197 was invalid (the CORS rejection) and is not counted.
- **Green on HEAD.** I ran `hel1665` + `hel1642` + `hel1583-home-375` + `hel1578-home-page`: **55 passed** (exit 0).
  Teardown deleted 55 users, and a check for `users like 'hel1665h-%'` returns 0. Evidence:
  `ref=/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final/green-head.txt`.
  Home jest: 15 suites, 99 tests pass. `eslint src/features/home --max-warnings 0`: clean.
- **Touch targets.** `bisectHitExtent` asserts ≥ 44 − step internally. Measured: `All N` 44.5 × 48.5 and
  `+N more` 44.5 × 54.5, with an 18px box and an 18px head. This follows the DESIGN.md §3 expander rule.
- **AC2 (parked, C2).** `item2-owner-handoff.md` contains the four options, the before/after 375×667 numbers (heading
  bottom 546.8, first row 563.8–643.8, nav 599) and the residuals. This is a correct owner hand-off. I judge AC2 as
  documented-and-parked.
- **Visual review.** Dev account, live app:
  - Settled 375×667 in dark and light (`head-375x667-settled-a.png`, `head-375x667-light-settled.png`): the theme
    parity is good, the "All 6 →" link sits on the eyebrow's line, and the console shows no errors.
  - Loading and settled states at 480 and 1280, from the evaluator's frames (`eval2-loading/settled-*`): coherent.
    The legend while loading reads naturally. The 1280 loading-to-settled change is pixel-stable.
- **C1 desktop boxes, live, base vs HEAD (1280×900 dark, same account).** The opening, shelf head, shelf, runs card,
  runs head and side boxes are identical. **The one difference is the sentence box: 587px on base, 600px on HEAD.**
  That difference is the finding below.

### Verdict: REFUTE

### Change Requests

1. **The `max-width: 25em` change alters Home's settled desktop layout, and the stated reason for it is false.**
   - **Location.** `frontend/src/features/home/ui/HomePage.css:28-30`. The comment says "25em is the same 600px as
     40ch in Schibsted Grotesk". design.md's cycle-3 addendum says "(Schibsted's `ch` is 0.625em, so the same 600px
     once loaded)".
   - **Measured.** In the running app, with Schibsted Grotesk loaded at 24px:
     - `40ch` = **586.875px** and `25em` = **600px**. The live base sentence box is 587px; HEAD's is 600px.
     - So the measure is 13px wider at every width where the cap binds (desktop and tablet).
     - I enumerated `buildSummarySentence` over counts {0,1,2,3,12}⁴. **19 of 625 sentences change from 3 lines to 2
       lines** at 1280. Example: "One dashboard changed since your last visit. One run failed and one run looks
       stuck, everything else is quiet." On a settled desktop Home, everything below the sentence for those users
       moves up 30px.
     - Evidence:
       `ref=/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final/desktop-sentence-wrap-40ch-vs-25em.json`.
   - **Why this is a REFUTE.** The spec delta's own SHALL says: "For a user with dashboards, Home's settled layout at
     desktop width (1280px, fine pointer) SHALL be unchanged by these rules". The driver's rule is "Home desktop
     unchanged when settled". This change breaks both for those users. C1's pins do not catch it because the pinned
     fixture uses the one-line default sentence.
   - **No clean em value exists.** A cap equal to 40ch (≈24.45em) brings back the cold-load swap: the fallback-font
     default sentence is 591.5px wide, more than 586.9px, so it would wrap. The executor must pick one of these and
     make the docs true:
     - **(a)** Keep an em cap, and state the desktop change honestly:
       - correct the CSS comment and the design.md addendum (40ch = 586.9px, not 600px);
       - add it to the spec's bound text (it "MAY wrap a longer sentence later, up to 13px wider"), or tighten the
         SHALL;
       - add it to `item2-owner-handoff.md`'s residuals and the PR's "UI decisions taken overnight", with the
         19/625 measurement.
       - Optionally use the smallest cap that still holds the fallback sentence (about 24.7em ≈ 593px), which narrows
         the affected set; re-measure if you do.
     - **(b)** Restore `40ch` and fix the cold-load swap another way, such as a metric-matched `size-adjust`
       fallback. That is outside Home files, so it needs escalation per design Decision 5.
   - **Either way:** the CSS guard (`HomePage.css.test.ts`, "caps the opening sentence in em") and the e2e must match
     the chosen value. Add one 1280 settled assertion on a longer sentence (for example the example above) that
     pins its line count, so the chosen behaviour is pinned and not just described.

### Non-blocking notes

- **431–604px loading placeholder** (`HomeOpeningLine.tsx` / `HomePage.css` `.home-opening__skeleton-line`): one
  shimmer bar centred in a two-line block leaves about 15px of blank space above and below it. That is acceptable
  under DESIGN.md §7 (a skeleton of predictable resolved size). Two bars, one per ghost line, would read better on
  phones. This is polish, not a blocker.
- `.home-opening__skeleton-line { height: var(--text-xl) }` uses a type-scale token as a box height. It works, but a
  control or skeleton metric would be more accurate. `width: min(520px, 80%)` keeps base's raw 520px (it was an
  inline prop before); no change requested.
- The legend shown while loading, the hidden link slot, and the 605–615px cold-load band plus the "Serif headings"
  caveat are all disclosed. I accept them as owner residuals. The Serif-headings measure also changes (640 → 600px);
  that belongs in the same disclosure as CR1.
- **Side effect of my red run:** the gitignored `e2e-evidence/HEL-1665/*.json` files were briefly overwritten with
  base-run values. The green HEAD run then rewrote them with HEAD values. The executor's `red-final/`, `mutations/`
  and `cycle*/` subfolders were not touched.
- **Gate-defect check:** no mtime-ordering claim was accepted. Every conclusion here rests on content measurements
  and test output.
