# HEL-1665 item 2 (short phones, 375x667): owner hand-off

## Resolution

Owner ruling (accept-as-is, constraint C3): item 2 is accepted as is, with no short-phone layout change. AC2 is relaxed to:
at 375x667 the timeline heading and the top of the first row are visible above the nav; scroll for the rest (light and
dark). The PR closes HEL-1665. The rest of this file is the original hand-off, kept for the record.

Item 2 was parked (constraint C2, now retired) and then accepted as is by owner ruling (C3, see Resolution).

## Measured AFTER item 1 (e2e-evidence/HEL-1665/short-phone-375x667-{light,dark}.json; identical in both themes)

Fixture: four dashboards, one pipeline with two succeeded runs, default "All quiet" sentence (two lines at 375).

| Measure (px, scroll 0)                   | Before item 1 (base) | After item 1 |
| ---------------------------------------- | -------------------- | ------------ |
| runs card top                            | 506.8                | 480.8        |
| runs heading bottom                      | 572.8                | 546.8        |
| first `.tl-disc__head` top               | 589.8                | 563.8        |
| first `.tl-disc__head` bottom            | 669.8                | 643.8        |
| bottom nav top                           | 599                  | 599          |

After item 1 the runs heading (546.8) and the first row's top (563.8) are above the nav (599). The first row's
bottom (643.8) is still 44.8px behind it: the first disclosure label wraps to two mono lines in this fixture, so the
row is 80px tall. The settled phone layout is 26px shorter than base because the section-head link no longer grows
its heading to 44px (the touch floor moved to the sized `::after` expander).

## Options (each needs an owner ruling)

1. A height breakpoint (e.g. `max-height: 700px`) shrinking the shelf thumbnail: needs a DESIGN.md section 4
   amendment (breakpoints are mechanical: 1440/1100/768/430 only).
2. A viewport-unit clamp on the thumbnail: `dvh` re-introduces a shift as browser chrome toggles; `svh` applies on
   most in-browser phones and shrinks the shipped HEL-1642 shelf there.
3. A width-only thumbnail shrink at <=430px: shrinks the shipped HEL-1642 phone shelf at every phone height.
4. Relax AC2 to "heading and the first row's top above the nav" (already true after item 1: 546.8 / 563.8 vs 599).

## Item-1 residuals to carry into the PR body

- Sentence line count: the placeholder matches the DEFAULT sentence ("All quiet: ...", two lines up to 604px, one line
  from 605px; measured 375: 2, 430: 2, 480: 2, 604: 2, 605: 1, 768: 1, 820: 1, 1280: 1). A loaded sentence with another line count moves the
  timeline by the difference (measured: a three-line sentence at 375 moves it exactly 25px = one line; on phones the
  common one-failed-run sentence is one line, so it moves the timeline up by one line).
- Legend for zero pipelines: the runs head shows the legend while loading, so a user whose summary has no pipelines
  sees it disappear.
- Web-font swap (cold load): depends on the platform's fallback font; recorded, not asserted. Runs card top spread before the
  web fonts arrive, px (light theme, dashboards-first, the shift spec's own fixture). Base is 647734111; "docker" = the
  Playwright 1.55.1 noble image's browser driven by the host specs, with fonts-dejavu installed so the fallback matches CI's.

| width | base local | HEAD local | base docker + DejaVu fallback (CI-like) | HEAD docker + DejaVu fallback (CI-like) |
|---|---|---|---|---|
| 375 | 2 | 4 | 4 | 8 |
| 430 | 2 | 4 | 4 | 8 |
| 480 | 2 | 4 | 4 | 8 |
| 540 | 2 | 4 | 4 | 8 |
| 620 | 2 | 4 | 4 | 24 |
| 1024 | 2 | 4 | 4 | 22 |
| 1280 | 2 | 3 | 4 | 24 |

  A wide fallback wraps the hidden default sentence, so this change is worse than base there (8px at phone widths, 22-24px
  at 620-1280). The owner chose not to add a nowrap/token workaround (it was tried and removed: it needed a type-style
  token and still left 605-768px). Only a `size-adjust` fallback (outside Home) would remove it.
- Opening placeholder: now the hidden default sentence (cycle 2), exact at every width including 431-604px.
- Zero-dashboard (first-run) shelf head is up to the link's line (~5px) taller than on base.
- "Serif headings" cold load: the evaluator's approximation measured a swap of about 30px at 540px (settled layout unchanged). The owner should confirm with the real font loading.
