## Standing Constraints

- [C1] Band fix = owner ruling ghost-nowrap-band: nowrap only on the hidden loading placeholder, Sans only, band start in em from the web font measured wrap point. Ship only if a 320-1300px placeholder sweep shows zero differences in CI-like (Liberation) and DejaVu-only envs, light and dark; existing 0px series and hel1678 <=4px stay green; new check red on base. Any sweep difference = stop and escalate; never narrow the AC unilaterally.

## 1. Measure base and decide D3 feasibility (before any test or fix)

- [x] 1.1 Bring up the CI-like browser (Playwright noble 1.55.1 + fonts-dejavu, Liberation kept) per the HEL-1678 recipe in `openspec/changes/archive/2026-11-16-metric-matched-fallback-fonts/` (measurements.md, evidence/tools/). Also bring up the DejaVu-only environment (`dv`, HEL-1678's `head-dv`: the same image with `fonts-liberation` removed). Remove each container by exact id when done. Confirm the pre-swap face with CDP `CSS.getPlatformFontsForNode`.
- [x] 1.2 Extend `chunit.mjs` (copy into this change's `evidence/tools/`) to measure with the REAL computed style (24px and 36px, weight 400, `letter-spacing: -0.01em`): each web font's 40ch (Schibsted, Fraunces, JetBrains Mono) and the default sentence's width in the web font and in each Sans fallback face; plus the `.home-opening` content-box width at 605, 606, 608, 610, 612, 613.
- [x] 1.3 **FAIL (both faces; see evidence/measurements.md; escalated).** D3 feasibility: sweep a sentence-only `size-adjust` for each Sans fallback face (the Liberation-matched face in the CI-like container; the DejaVu-matched face in the `dv` container, where CDP `getPlatformFontsForNode` must report DejaVu Sans, otherwise the run is void; down to 4% below HEL-1678's value, relative: e.g. 104.94% x 0.96 = 100.74%). PASS needs both, per face: (i) with fonts and `/api/home-summary` held, the fallback ghost is one line at 605 and two at 604, exactly as the web font (use the web font's MEASURED wrap boundary from 1.5 if it is not 604/605); (ii) a 320-1300px every-width sweep (HEL-1678 final skeptic's `vsweep.cjs` method, in the face's own container as above) of ghost line count and height, fallback versus web font, has zero differing widths. Record PASS (the value per face, sweep output) or FAIL in `evidence/measurements.md`. On FAIL, STOP and return `ESCALATION` with the numbers and D3's options; do not start 2.3 or 3.2, and do not widen the 4% budget.
- [x] 1.4 (done via 7.1) If 1.3 FAILs: after the escalation is answered, revise `specs/home-page/spec.md` (the band SHALL, the 605-615 carve-out, the 610 data-before-font case and the scenarios) to match the answer before any band test or fix, and re-validate.
- [x] 1.5 (610 data-before-font base number not taken: see 2.3) (desktop and data-before-font recorded; band cases wait for the escalation) Measure base cold-load swap at 605-613 (the six widths), 1024, 1280, 1440 (both data orders) and the data-before-web-font case at 610, 1024, 1280, 1440, light and dark; record in `evidence/measurements.md`.

## 2. Tests first (red on base)

- [x] 2.1 Desktop: add the 1440 cold-load case and the data-before-web-font cases at 1024, 1280, 1440 (D4), with platform-font evidence.
- [x] 2.2 Restate the `keeps the 40ch measure` test per D4 (computed cap equals the web font's 40ch within 0.5px, line count unchanged, with a `document.fonts.check` web-face precondition), for Sans, Serif and Mono at 1280.
- [x] 2.3 (done via 7.2) Band: the 605, 606, 608, 610, 612, 613 cold-load cases were added. The planned 610 data-before-web-font case was NOT added and is dropped: the real sentence wraps at 589/581px in the fallback against a 581-589px content box, and the owner ruling (ghost-nowrap-band) covers only the placeholder. Accepted residual (owner ruling accept-residual-with-followup), tracked by follow-up HEL-1748; the 605-613px remove-the-carve-out text applies to the cold-load swap only.
- [x] 2.4 (desktop cases; red in `evidence/base-red.txt`) Run the new cases against base CSS in the CI-like environment, light and dark; keep the red output as evidence. Label already-green-on-base tests as guards.

## 3. Fix

- [x] 3.1 (3A, desktop) D1/D2 in `frontend/src/features/home/ui/HomePage.css`: `--home-sentence-measure` per type style (values from 1.2), used by the sentence and the ghost; remove the ghost-only `25em`; rewrite the comments.
- [x] 3.2 (superseded by 7.3, owner ruling) (3B, band; only after 1.3 PASS) D3: the two Home-opening-only fallback faces with the measured `size-adjust` and rescaled overrides, used by the sentence and ghost under the Sans style only (applied by default and reset under the serif and mono `data-type-style` selectors, so both no-attribute and any sans value are covered).
- [x] 3.3a (done via 7.4) (waits for the escalation: only applies if a band face is added) Repeat the 320-1300px every-width sweep from 1.3 on the final head CSS, both fallback faces, each in its own container (CI-like for Liberation, `dv` for DejaVu, CDP-proven); zero differing widths; record in `evidence/measurements.md`.
- [x] 3.3 Re-run the full hel1665 spec and `hel1678-home-large-font.spec.ts` in the CI-like browser and on host, light and dark; all green. Also run the new band and 1440 cold-load cases in the `dv` container, light and dark. Record head numbers next to base in `evidence/measurements.md`.

## 4. Visual check

- [x] 4.1 Before/after screenshots with web fonts loaded at 375, 602, 604, 610, 1024, 1280 in light and dark (Sans; plus Serif and Mono at 1280), compared against the running app; pixel-diff and record that the settled rendering is unchanged.

## 5. Placeholder polish (time-boxed, D5)

- [x] 5.1 DEFERRED to follow-up HEL-1749 (not attempted: the 431-604px ghost shares the band work awaiting the escalation answer). Attempt one skeleton bar per placeholder line at 431-604px with pure CSS on the existing ghost. Keep it only if it matches the existing skeleton look in light and dark and the 0px series stays green; otherwise revert and record "deferred to follow-up" here.

## 6. Gates

- [x] 6.1 Frontend lint, typecheck, format, jest (maxWorkers 3); `openspec validate font-independent-home-sentence-cap --type change`.
- [x] 6.2 Clean up any dev-DB residue created by the e2e runs by exact id (the harness's guarded `buildUserDeleteSql`).

## 7. Band, owner ruling ghost-nowrap-band (escalation answered 2026-11-17, replaces 3.2's size-adjust face)

- [x] 7.1 Revise `specs/home-page/spec.md` (task 1.4): restore the band SHALL (605-613px, CI-like and DejaVu-only, light and dark) and the 605-615 carve-out removal, describing the placeholder rule; re-validate.
- [x] 7.2 (no 610 data-before-font case; see 2.3) Band e2e cases (task 2.3): 605, 606, 608, 610, 612, 613 cold-load (`fontSwapSpread <= 4`, light and dark, non-vacuity checks); run red on base in the CI-like env and keep the output.
- [x] 7.3 Fix in `HomePage.css`: under the Sans style only, in a media query from the web font's measured wrap point expressed in em (605px / 16 = 37.8125em) to the band's top, `.home-opening__ghost` gets `white-space: nowrap; overflow: hidden`. The real sentence is untouched. Comment why (HEL-1737, the pixel-rounded fallback widths).
- [x] 7.4 Owner condition 1: full 320-1300px placeholder sweep, fallback vs web font, zero differing widths, in CI-like (Liberation) and dv (DejaVu) containers, light and dark, CDP-proven faces. Any difference: STOP and return ESCALATION.
- [x] 7.5 Owner condition 2: full hel1665 + hel1678 specs green (CI-like, host; band + 1440 cases in dv), and the large-font spec. Also confirm the Serif/Mono placeholder is unaffected.
- [x] 7.6 Gates (6.1) re-run; commit.
- [x] 8.1 Cycle 2: move the per-style measure and the Sans-only nowrap switch to `theme.css` tokens, restore the `data-type-style` guard in `HomePage.css.test.ts`; re-run the sweep and suites.
- [x] 9.1 Cycle 3: remove the blind retry poll from the measure test (keep the settle waits), withdraw the unsupported base-`40ch` claim, state the residual as owner-accepted (HEL-1748) and the polish as HEL-1749.
