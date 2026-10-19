## Context

See proposal.md (Why). Ground truth on origin/main 647734111:

- `DashboardShelf.tsx` renders the shelf head's `<Link className="home-section__link">All N →</Link>` only when
  `dashboards.length > 0`; the loading-skeleton branch has no link. `HomePage.css`'s touch block
  (`@media (max-width: 768px), (pointer: coarse)`) gives `.home-section__link` `display: inline-flex; min-height: 44px`
  (grow-the-box), so on phones/coarse pointers the head grows from the eyebrow's line height to 44px when the link
  mounts. That is the ~31px the ticket reports (to be confirmed by measurement, not assumed). The same class is used
  by the runs card's "+N more" link (`PipelineRunsCard.tsx`).
- HEL-1642 evidence (`.concertino/runs/HEL-1642/evidence/home-375x667-light.json` and its screenshot): at 375×667 the
  timeline list has top 563.8 and the bottom nav's top is 599. In that fixture the first disclosure label wraps to two
  mono lines, so the first `.tl-disc__head` is ≈84px and its bottom ≈648, ≈49px behind the nav (round-1 skeptic).
- The runs card head (`PipelineRunsCard.tsx`) also uses `.home-section__head`; once loaded it adds `TimelineLegend`,
  which at 375 wraps to its own row (eyebrow y≈509, legend y≈539 in the HEL-1642 screenshot), so the card's content
  drops ≈34px on every phone load. The opening sentence (`max-width: 40ch`) renders the default "All quiet: nothing has
  changed, failed or been missed." on two lines at 375/430 (≈482px needed) and on one line at 820/1280 (HEL-1642
  screenshots, ≈579px wide); its loading placeholder is a 28px line.
- DESIGN.md §3: compact controls take the 44px touch floor through a sized `::after` expander
  (`position: relative`, 44px, centred), guarded by `shared/ui/tapTargetTestUtils.ts` `expectTapExpander()`;
  grow-the-box is for full-width list/menu rows. A section-head text link is not a full-width row.

## Goals / Non-Goals

**Goals:** the timeline card's top moves 0px between Home's first paint and its settled state (phone, tablet-coarse
and desktop widths, both themes) for the shelf and the default opening sentence; item 2 (short phones) is accepted as is, AC2 relaxed (Decision 0); HEL-1642's spec and measurements stay green; desktop Home (1280, fine pointer) pixel-identical in layout.

**Non-Goals:** HomePage.css split/tidy (HEL-1666); reordering Home sections; the timeline's own row design; any
file outside `frontend/src/features/home/**`, its tests, `e2e/`, and DESIGN.md (pipeline pages are HEL-1668, accent
hover tokens HEL-1669 — touching their files must be reported before committing).

## Decisions

0. **Scope this run.** Owner ruling (accept-as-is, C3): item 2 is accepted as is, AC2 is relaxed to "at 375×667 the
   timeline heading and the top of the first row are visible above the nav; scroll for the rest", and the PR closes
   HEL-1665. Item 2 was **not built**: a `max-height` query is a new breakpoint value and DESIGN.md §4
   ("CSS media queries use these values only": 1440/1100/768/430) is [mechanical]; a viewport-unit clamp is no better
   (`dvh` resizes thumbnails as browser chrome toggles, a new shift; `svh` applies on most in-browser phones, so it
   shrinks the shipped shelf); the width-only alternative shrinks the HEL-1642 phone shelf at every height. None is an
   overnight reversible decision. Disposition and AC2 judgement: owner ruling C3 (accepted as is; AC2 relaxed; the PR closes HEL-1665).
1. **The shelf head never changes height (chosen; overnight reversible UI decision).**
   a. The SHELF head only (`.home-section > .home-section__head`, or a dedicated modifier class on the shelf's head —
      never the shared class, which the runs card also uses) gets a token-derived `min-height` equal to the link's line
      box, matched to the settled 1280 head height measured on base. In every state (loading, loaded, zero dashboards)
      it is the same height. Consequence, stated in the spec: the zero-dashboard (first-run) head is ≈6px taller than
      on base; with dashboards the desktop layout is unchanged (C1).
   b. In the existing touch block `.home-section__link` loses `display: inline-flex; min-height: 44px` and takes the
      DESIGN.md §3 `::after` expander, **`square`** shape (`position: relative`; 44×44 centred), guarded by
      `expectTapExpander(..., "square")`. `.home-upnext__row` keeps grow-the-box. Confirm with the existing bisection in
      `e2e/support/touchTargetProbe.ts` at 375 that `All N` and `+N more` reach ≥44−step and overlap no neighbour.
   - *Alternative: reserve a 44px slot in the skeleton.* Rejected: keeps ~23px dead height on phones. Fallback only if
     the bisection fails (record why).
2. **Skeleton shelf cards match loaded cards exactly.** HEL-1642 measured skeleton 113.9 vs loaded 117.9px per card at
   375. The skeleton foot placeholder takes the loaded foot's line height (a class, tokens only), so card heights are
   equal at every width.
3. **Runs card head is the same while loading (chosen; overnight reversible UI decision).** `PipelineRunsCard` renders
   `TimelineLegend` in the head while the summary is loading as well as when there are pipelines, so the head (and the
   list/skeleton below it) does not move when the summary arrives. A user whose summary then turns out to have zero
   pipelines sees the legend disappear (the empty state replaces the list); stated in the spec bound.
4. **Opening placeholder matches the default sentence's line count per width.** First measure the default sentence's
   line count at 375, 430, 768, 820 and 1280 into evidence. The placeholder (keeps `role="status"` / "Loading
   summary", class-sized, no inline height) is one `.home-opening__sentence` line (`--text-2xl` × 1.25) by default and
   two lines (`--text-xl` × 1.25 each) inside the existing `max-width: 430px` block — no new breakpoint value. If the
   measurement shows a different count in some band (e.g. 431–768), use the existing 768/1100 breakpoints to match it
   and record the numbers. A sentence whose line count differs from the default at that width moves the timeline by
   the line difference; stated in the spec bound, measured, handed to the owner.
5. **Find every other mover by measurement.** The probe below samples every frame; anything else that moves the runs
   card's top is fixed within Home files with tokens only. If a mover lives outside Home (shell/nav), stop and
   escalate rather than editing it.
6. **e2e: new `e2e/hel1665-home-phone-stability.spec.ts`**, seeded like `e2e/hel1642-home-phone-timeline.spec.ts`
   (four dashboards with at least one real multi-panel layout, one pipeline with only succeeded runs so the sentence is
   the default "All quiet: ..." (two lines at ≤430, one line above, per Decision 4's measurement); `registerAndLogin(..., isolate: true)`):
   - *Shift (0px case):* 375×667, 375×812, 430×932 and 1280×900 × light/dark × **both resolution orders**. Hold
     `/api/dashboards*` and `/api/home-summary*` with `page.route`, release them one at a time, and sample every
     animation frame (rAF recorder via `addInitScript`) from first paint through settle: the runs card's top, the top
     of the runs card's content start (the loading skeleton, then the timeline list), and the shelf's top. Assert each
     series' max − min is 0 (≤0.5px sub-pixel tolerance, stated). Before measuring, assert the settled sentence has the
     default line count for that width (Decision 4's measured count: height / line-height). Log `layout-shift` entries with sources to evidence.
   - *Bound case:* a fixture whose sentence is three lines (e.g. changed dashboards + failed + stuck clauses) at 375:
     assert the timeline content start moves by exactly one sentence line (± 0.5px) and nothing else.
   - *Desktop unchanged (C1):* at 1280×900 assert the settled boxes — opening line, shelf head, shelf, runs card top,
     runs card head, first timeline row — equal numbers pinned in the spec, measured on base 647734111 (base run saved
     to evidence).
   - Evidence JSON + screenshots to `evidencePath("HEL-1665", ...)` and copied to
     `/home/matt/Development/helio/.concertino/scratch/HEL-1665/`, at 375×667, 375×812, 430×932, 1280×900, both themes.
   - **Fails first:** run the spec on the unmodified code and capture red to evidence. Mutations: restore the link's
     `min-height: 44px`; drop the shelf head `min-height`; restore the 28px opening skeleton; apply the phone two-line
     placeholder rule at desktop (the 1280 case must go red); stop rendering the legend while loading — each must turn a
     test red.
   - HEL-1642's spec, `hel1583-home-375.spec.ts` and `hel1578-home-page.spec.ts` stay green.
   - *Owner hand-off for item 2:* a 375×667 info measurement (light/dark) of the runs heading bottom and first
     `.tl-disc__head` bottom vs the nav top AFTER item 1, saved to evidence and scratch with screenshots.
7. **Unit:** a new Home CSS guard test (none exists) using `expectTapExpander()` for `.home-section__link` in the
   touch block.
8. **DESIGN.md:** one sentence on the Home entry: section-head links take the §3 expander and the head reserves the
   link's line so Home does not shift on load (HEL-1665).

## Risks / Trade-offs

- [Expander overlaps the first shelf card's hit region] → bisection check (Decision 1); fallback to slot reservation.
- [A multi-line opening sentence still shifts the timeline] → stated in the spec bounds and handed to the owner.
- [Shelf head `min-height` changes the zero-dashboard head] → ≈6px taller for a new user; stated in the spec.
- [Legend shown while loading disappears for a zero-pipeline user] → stated in the spec bound.
- [Removing the link's `min-height` changes tablet-coarse layout by ~31px] → intended (same fix); desktop fine
  pointer unaffected because the touch block does not apply there.
- [Shared dev DB / Playwright] → seeded users deleted by exact id before cleanup; full suites under the e2e lock.

## Migration Plan

CSS/TSX only; revert the commit to roll back.

## Implementation note (executor, cycle 1)

Decision 1a as built: the shelf head's reserved line is a hidden slot, not a `min-height`. Measured on base, the link's
line box is font-metric (`line-height: normal`, 18px at 14px Schibsted Grotesk; the no-link head is 13px), so no
token expression reproduces the settled 18px exactly, and a `calc()` guess would break C1 or the 0px bound on another
font fallback. `DashboardShelf` renders `<span class="home-section__link-slot" aria-hidden>&nbsp;</span>` (same
`--text-sm`, `visibility: hidden`) in the link's place until `dashboards.length > 0`, so the head is the link's own line
box by construction. The skeleton foot (Decision 2) uses the same technique (the loaded foot's own boxes with a hidden
text line each, the bar laid over the name's). The zero-dashboard head is the link's line (about 5px taller than base),
as the spec allows. The e2e mutation for "drop the shelf head min-height" is "drop the link slot" (M2).

## Implementation note (executor, cycle 2): Decision 4 superseded

Decision 4's per-width CSS (one `--text-2xl` line, two `--text-xl` lines inside the 430px block) is replaced. The default
sentence is two lines from 431 to 604px and one from 605px (measured at 1px steps by the evaluator; the 605px switch is
not a canonical breakpoint), so per-width rules left a 30px shift at 431-604px. The loading placeholder is now the default
sentence itself (`buildSummarySentence` with zero counts) rendered as a hidden (`visibility: hidden`, `aria-hidden`)
`.home-opening__sentence` inside the `role="status"` / "Loading summary" wrapper, with the skeleton bar laid over it, so
its height is the default sentence's at every width by construction. Reversible overnight UI decision (PR body). The e2e
adds 480x900 and 540x900 (shown red on 5214e3b6b: runs card top spread 30px) and line-count tests at 480/604/605.

Decision 5 addendum (corrected in cycle 4): the cold-load web-font swap was 33-34px at every width >=605px with the
hidden default sentence, not a global font-metric issue. Cause: Home's `ch`-based cap; `ch` follows the rendered font,
so in the system fallback font the 40ch box was narrower than the default sentence and the hidden ghost wrapped to two
lines. Fix (final): the REAL sentence keeps `max-width: 40ch` (settled Home, including every longer sentence, is exactly
base), and only the hidden placeholder takes `max-width: 25em` (600px at 24px, in any font). A 25em cap on the real
sentence was tried in cycle 3 and rejected by the final-gate skeptic: the skeptic measured 40ch as 586.9px and 25em as
600px, which widens the measure of settled sentences. Measured here (Playwright Chromium, Google-served Schibsted
Grotesk): 40ch resolves to 600px and the ghost and real default sentence have identical settled line counts at
375/430/480/604/605/610/620/640/768/1024/1100/1280; a long four-clause sentence settles at two lines at 1280 as on base,
and the e2e asserts the real sentence's computed cap equals whatever `40ch` resolves to (environment-independent; red
when the cap is changed, e.g. 24em gives 576px). With "Serif headings" the real sentence's box is back to base.
The cold-load swap depends on the platform's fallback font, so it is recorded (evidence JSON `fontSwapSpread`, log) and not
asserted. CI (ubuntu, DejaVu-like fallback) measured 8px at 375-540 and 22-26px at 620/1024/1280. A ghost `white-space: nowrap`
(cycle 6) and then a `--heading-sentence-wrap` theme token (cycle 7) were tried and removed by owner ruling (drop-nowrap):
they needed a type-style token and still left 605-768px. Final measured numbers are in the table in
`item2-owner-handoff.md` (docker + DejaVu: 8px at 375-540, 22-24px at 620-1280; base 4px; local 3-4px). Only a `size-adjust`
fallback (outside Home) would remove it.

## Implementation note (executor, cycle 5): the placeholder is its own class

The hidden placeholder shared `.home-opening__sentence`, so `e2e/hel1572-appearance-preferences.spec.ts` ("no flash:
Home's opening sentence is serif", `locator(".home-opening__sentence").first().evaluate(getComputedStyle...)`) matched the
placeholder; when the summary arrived mid-evaluate the placeholder unmounted and `getComputedStyle` of the detached
element returned "" (reproduced 4/8 on 837363bfa, 8/8 green on base 647734111). The placeholder is now
`.home-opening__ghost` (shared typography selector list with `.home-opening__sentence`; `40ch` stays on the real
sentence only, `25em` and `visibility: hidden` on the ghost), so `.home-opening__sentence` matches only the real
sentence. No measured HEL-1665 guarantee changes.

## Implementation note (executor, cycle 8)

The cycle-6 `nowrap` ghost shifted the timeline 30px under the Mono type style (red e2e, 30px at 1280). The cycle-7 token fix
was then dropped by owner ruling together with nowrap: the ghost wraps like the real sentence in every style again, and the
Mono, Serif and Sans held-load cases stay asserted at 0px.
