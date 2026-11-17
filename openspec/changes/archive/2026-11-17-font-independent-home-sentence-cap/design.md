## Context

`frontend/src/features/home/ui/HomePage.css` caps `.home-opening__sentence` at `max-width: 40ch` and the hidden
placeholder `.home-opening__ghost` at `max-width: 25em` (HEL-1665). Both render in `var(--font-heading)` at
`var(--text-2xl)` (1.5rem, 24px at the default root size) with `letter-spacing: -0.01em`. `--font-heading` is Schibsted
Grotesk by default, Fraunces under `:root[data-type-style="serif"]`, and JetBrains Mono under
`:root[data-type-style="mono"]` (via `--font-sans`). The fallback faces are the HEL-1678 `@font-face` rules at the top of
`frontend/src/theme/theme.css` (`Schibsted Grotesk Fallback Arial` = Liberation Sans in the CI-like set, `... Fallback
DejaVu`).

The ticket's two gaps have two different causes (corrected after design-gate round 1):

1. **605-613px band: the ghost is container-bound.** The cold-load swap the e2e measures (`fontSwapSpread` in
   `e2e/hel1665-home-phone-stability.spec.ts`) is sampled while both APIs are held, so the element on screen is the
   loading ghost, not the real sentence. The ghost's cap is already font-independent (25em = 600px). At 605-613px the
   `.home-opening` content box is about 581-589px wide (12px page padding a side at <=768px), narrower than the cap, so
   the cap does not bind: the wrap is decided by the default sentence's own rendered width in each face. HEL-1678's
   final skeptic (`skeptic-final-1.md`) observed the ghost differing at exactly 605-613px. The web-font sentence fits one
   line there and the (wider) fallback-rendered sentence wraps to two. Changing any cap does nothing here.
2. **Desktop, data before web font: the real sentence's 40ch shrinks.** With data loaded first, the real sentence is on
   screen in the fallback; its 40ch cap is about 560px there versus 600px in the web font, so it wraps to two lines and
   reflows to one when the web font arrives (about 30px). A font-independent cap closes this.

The numbers HEL-1678 recorded (`chunit.mjs`: web sentence 593px, fallback 594-602px) were measured without the
sentence's `-0.01em` letter-spacing, so they are not the rendered widths (roughly 13px narrower in reality). This design
cites no wrap-point number until task 1 re-measures them with the real computed style.

Ground truth for the tests is `e2e/hel1665-home-phone-stability.spec.ts` (`VIEWPORTS`, `fontSwapSpread <= 4`, the 0px
data-load series, `Home settled at 1280x900 ... keeps the 40ch measure`) and `e2e/support/homeLoadProbe.ts`. The CI-like
environment is `mcr.microsoft.com/playwright:v1.55.1-noble` + `fonts-dejavu` (Liberation kept), browser via
`playwright run-server` in the container, driven from the host against this lane's dev server (recipe in the HEL-1678
archive: `measurements.md`, `evidence/tools/`).

## Goals / Non-Goals

**Goals:**
- Desktop (1024, 1280, 1440) with data before the web font: the run timeline moves at most 4px when the font arrives,
  light and dark, CI-like font set (fixed by D1).
- 605-613px cold-load swap at most 4px, light and dark, CI-like font set (fixed by D3, gated on its feasibility check).
- With the web fonts loaded, the settled sentence has the same computed cap (within 0.5px) and the same line breaks as
  base at every tested width, under Sans, Serif and Mono: no visible change after the fonts load.
- New checks red on base in the CI-like environment, light and dark (C12).

**Non-Goals:**
- Changing the shared fallback faces' `size-adjust`/overrides in `theme.css` (HEL-1678's tuned values stay; every other
  element keeps them).
- Changing the sentence templates, font size, letter-spacing or any other Home section.
- New Serif/Mono cold-load bounds beyond what the existing style-case tests assert (they stay green).

## Decisions

**D1. An `em` measure per type style, equal to the web font's own 40ch (closes gap 2).** Replace `max-width: 40ch` with
`max-width: var(--home-sentence-measure)` on `.home-opening__sentence`, the property set in `HomePage.css`: a default
for Sans and overrides under `:root[data-type-style="serif"]` and `:root[data-type-style="mono"]`. Each value is the
web font's 40ch width at 24px divided by 24, measured in Chromium (asserted from the measurement, not assumed: Sans is
expected near 25em and Mono near 24em, Fraunces unknown), to at least three decimals so the computed px equals base's
`40ch` within 0.5px. `em` follows the sentence's own font size (the 1.5rem token and the larger-default-font case) while
being independent of the rendering face. Rejected: `rem` (silently wrong if `--text-2xl` changes), `px` (breaks the
larger-default-font case), one 25em for all styles (changes Mono from 576px and Serif from its own 40ch: a visible
change). Hinting: at 36px (larger default font) the em value may differ from that size's 40ch by a sub-pixel amount;
recorded in evidence, and the large-font spec must stay green.

**D2. The ghost takes the same measure.** The ghost's `max-width: 25em` is replaced by the same
`var(--home-sentence-measure)`, so placeholder and real sentence share one cap in every style (under Sans this is the
same 600px as today; under Mono it moves the ghost from 600px to the sentence's 576px, both wider than the
two-line-at-1280 default sentence break; the existing Mono/Serif 0px style cases must stay green). Comments rewritten.

**D3. 605-613px: a sentence-only tighter fallback face, gated on a feasibility measurement first.** Because the band is
container-bound (Context 1), the only ways to close it are to make the default sentence's fallback-rendered width fit
the content box wherever the web-font rendering does, or to change the loaded rendering. The preferred mechanism keeps
the loaded rendering untouched: two Home-opening-only `@font-face` faces (`Schibsted Grotesk Fallback Arial Opening`,
`... DejaVu Opening`; same `local()` sources and vertical overrides re-scaled as HEL-1678 did, a smaller `size-adjust`)
used only by `.home-opening__sentence` and `.home-opening__ghost` under the Sans style, via a sentence-local font stack
(web face first, so once Schibsted loads nothing changes). Line box height is fixed by `line-height: 1.25` of the
font size, so a smaller fallback glyph scale does not change the line-box height.
Feasibility is decided in task 1, BEFORE any test or fix is written: measure, with the real computed style (24px,
weight 400, `letter-spacing: -0.01em`), the default sentence's width in the web font and in each CI-like fallback face,
and the `.home-opening` content-box width at 605-613px. PASS is two-sided and measured directly (hinting quantises
advances, so no width inequality is trusted): there is a single `size-adjust` per Sans fallback face (Liberation-matched
and DejaVu-matched), no more than 4% below HEL-1678's value for that face, at which (i) the fallback default sentence
switches from one line to two at the same viewport width as the web font (fits at 605, wraps at 604, with fonts and
`/api/home-summary` held so the ghost is on screen), and (ii) a full sweep of every viewport width from 320 to 1300px
(the HEL-1678 final skeptic's `vsweep.cjs` method: ghost line count and height, fallback versus web font; the
Liberation-matched face in the CI-like container and the DejaVu-matched face in the DejaVu-only `dv` container, each
proven by CDP `getPlatformFontsForNode`, since in the CI-like container Liberation wins and a "DejaVu" sweep there would
re-measure Liberation) shows zero differing widths for that face. A value that only shrinks the sentence can move the swap
below 605 or reopen HEL-1678's 320-330px band, so both checks are required; the 4% budget is not widened without the
owner. If no such value
exists (hinting does not move the width, or more than 4% is needed), the executor stops and returns `ESCALATION` with the
measured numbers; the orchestrator raises it with options: (a) narrow the AC band and record the measured residual,
(b) a sentence-only loaded-rendering change (e.g. letter-spacing) shown in before/after screenshots, (c) accept a larger
adjust. The band's spec text (task 1.4), e2e cases and fix wait for that answer and are rewritten per it; desktop work (D1/D2, D4
desktop cases) proceeds regardless.

**D4. Tests.** In `e2e/hel1665-home-phone-stability.spec.ts`:
- Add a 1440x900 cold-load case to the swap assertion (`fontSwapSpread <= 4`), light and dark. Only after D3's
  feasibility PASS (or per the escalation answer): add 605, 606, 608, 610, 612, 613 x 900 to the same assertion and
  remove the 620 comment about the disclosed residual.
- Add a "data before web font" case at 1024, 1280 and 1440 (a 610 case was planned but dropped: see the Owner ruling section), light and dark: hold the web-font requests
  (route the Google Fonts CSS/woff2 requests and release them after both API responses have settled and the page has
  rendered the loaded sentence), sample the runs card top per frame, assert the spread from the settled-data frame to
  the post-font frame is at most 4px. Also record the sentence's line count before and after the font release.
- Restate `keeps the 40ch measure`: assert the settled computed cap equals the web font's `40ch` within 0.5px (computed
  in-page as today) and the line count is unchanged (2). The test name changes to say "keeps the web font's 40ch width".
- Non-vacuity: each new swap and data-before-font case asserts the held font route was hit and released, and that after
  release the sentence renders in the web face (`document.fonts.check('400 24px "Schibsted Grotesk"')` or CDP), so a
  green result proves a swap happened.
- Each new case records the pre-swap platform font (CDP `CSS.getPlatformFontsForNode` on the sentence/ghost, web fonts
  held) into evidence so "rendered in the fallback" is proven, not assumed.
The new band and 1440 cold-load cases are also run in the `dv` container (DejaVu only), since the spec's swap bound
covers that fallback too.
Red first: run the new cases against base `6432e69e0` CSS in the CI-like environment, light and dark, and keep the
red output as evidence. Existing tests that are already green on base are guards, labelled as such.

**D5. Placeholder polish is time-boxed and pure CSS.** One skeleton bar per placeholder line at 431-604px is in scope
only if done by styling the existing ghost's text as inline line-fragment bars (e.g. an inline span with the skeleton
background and `box-decoration-break: clone`, transparent text, reusing the existing skeleton token/animation) with
no JS, no new component and no change to `Skeleton`. If that cannot match the existing skeleton look in light and dark
in a short attempt, it is filed as a follow-up and the current single bar stays. Either outcome is recorded in
tasks.md.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file or script the pre-commit hook runs is touched.

## Risks / Trade-offs

- [Serif em value measured imprecisely] -> settled Serif wrap could change at a width near its wrap point. Mitigated by
  the per-style 0.5px computed-cap check under Sans, Serif and Mono at 1280 (the restated measure test).
- [D3 face is overfitted to the default sentence] -> other sentences may still wrap differently in the band during the
  ~100ms fallback window; the AC and spec are about the default sentence (the ghost), which is what the cold-load swap
  shows. The sentence-only face never applies once the web font loads.
- [CI fonts differ from the local CI-like container] -> the e2e asserts the bound on CI's own fonts; the container
  numbers are evidence, CI is the assertion.
- [Visual change] -> D1 targets zero change with web fonts loaded; before/after screenshots at 375, 610, 1024, 1280 in
  light and dark, compared against the running app, are part of evidence. A visible difference is a D3-style
  escalation, not a silent accept.

## Owner ruling (escalation answered 2026-11-17): ghost-nowrap-band replaces D3's mechanism

Task 1.3 measured D3 infeasible. Chromium rounds the size-adjusted font size to a whole pixel, so the 24px default
sentence can only be 550.05 or 589.05px wide in the Liberation-matched face, and 555.05, 581.05 or 608.05px in the
DejaVu-matched face. The web font needs exactly 580.05px (see `evidence/measurements.md`). The owner chose
`ghost-nowrap-band`.

**D3'.** The web font puts the default sentence on one line from its measured wrap point (605px viewport; content box
581 >= 580.05) upward. So in the band, under the Sans style only, the hidden loading placeholder
(`.home-opening__ghost`, `aria-hidden`, `visibility: hidden`) is held on one line with `white-space: nowrap;
overflow: hidden`. Pre-font it is then the same height as with the web font. The band starts at a min-width in `em`
(37.8125em = 605px at a 16px default), so it scales with the browser default font size. The real sentence is not
touched, so the loaded rendering is unchanged.

**Ship conditions (owner):**
- A full 320-1300px placeholder sweep shows zero differences in both fallback environments, light and dark.
- The existing 0px series and the hel1678 <=4px assertion stay green.
- The new check fails first on base.

Any sweep difference means stop and escalate again. The AC is never narrowed unilaterally.

**Open residual (accepted by the owner; follow-up HEL-1748).** The ruling above covers the hidden loading placeholder
only. With the summary data settled before the web fonts, the REAL default sentence still wraps in the fallback at
605-613px (589px Liberation or 581px DejaVu against a 581-589px content box) and reflows by about 30px when the web font
arrives, light and dark. No 610 data-before-font case was added or asserted. The owner accepted this as a known residual
(ruling accept-residual-with-followup, "Owner ruling 2" below); it is tracked by HEL-1748 and carried in the PR body.

**Placement (DESIGN.md "Type styles", cycle 2).** The per-style measure and the Sans-only no-wrap switch are the tokens
`--home-sentence-measure` and `--home-ghost-white-space` in `theme.css` (default and the serif/mono type-style blocks);
HomePage.css reads only the tokens and has no `data-type-style` selector.

**Owner ruling 2 (escalation answered 2026-11-17): accept-residual-with-followup.** The 605-613px data-before-web-font
reflow of the real sentence (about 30px) is accepted as a known residual. It is not a requirement of this change. The follow-up is HEL-1748
(Low), named in the PR body.

**Owner ruling 3 (final gate, escalation answered 2026-11-17): accept-double-shift-and-document.** The final-gate
skeptic found that the residual above is not a single reflow in every case. In data-first order (dashboards list and summary arriving before the web fonts), Sans, light and dark, the run timeline
moves per fallback face as follows. Liberation-matched face (CI-like font set), 605-613px: the change moves it twice
(the one-line placeholder, then the two-line fallback sentence, +30px, then the one-line web-font sentence, -30px)
where base moved once; the first move is added by the placeholder rule. DejaVu-matched face (DejaVu only), 606-613px: the change does not move it (0px) where base moved it twice (placeholder one line, fallback sentence two lines, web-font sentence one line). At 605px the change moves it twice where base moved once (the placeholder rule adds the first move, as in the Liberation case). The fonts-first cold load moves 0px at every
width. The owner accepted the
residual as it actually behaves. This supersedes the single-reflow wording in "Open residual" and "Owner ruling 2"
above. HEL-1748 and the PR body describe it per fallback.
