# HEL-1737: Home opening sentence: replace the font-dependent 40ch cap so it stops re-wrapping during the font swap

## Description

origin_kind: followup
origin_ticket: HEL-1678 (PR matto00/helio#1137, merged as 54b18b7ce)

HEL-1678 added fallback fonts matched to the web fonts' metrics. With them, a cold first load of Home moves 0px at every width the hel1665 spec covers. Two gaps remain, and both come from the `40ch` cap on Home's opening sentence. A `ch` is the width of the current font's `0`, so the cap's width changes when the web font replaces the fallback.

1. **605-613px is worse than before.** The sentence wraps differently under the fallback font, giving a 30px shift at 606 and 610px. Base shifted 22-24px there.
2. **Desktop widths.** When data arrives before the web font, the loaded sentence still reflows by about 30px. Base has the same problem.

Also deferred from HEL-1665: the placeholder shows one skeleton bar per line at 431-604px.

**Fix direction:** express the cap in a unit that doesn't depend on the font, such as `rem` or `px`.

## Acceptance Criteria

- Under a CI-like fallback font, the cold-load swap is at most 4px at 605-613px and at desktop widths, in light and dark.
- The existing 0px series and the HEL-1678 ≤4px assertion stay green.
- The new check fails first.

## Agent notes

Evidence: `openspec/changes/archive/2026-11-16-metric-matched-fallback-fonts/measurements.md` and its `evidence/tools/chunit.mjs` (the ticket's `.concertino/runs/HEL-1678/evidence/tools/` path is stale; the tools are in the archived change's `evidence/tools/`).

Measure in the CI-like environment HEL-1678 used: Playwright noble 1.55.1 with `fonts-dejavu` added and Liberation kept. Confirm which font actually renders with CDP `getPlatformFontsForNode`.

## Driver context (claims to verify)

- HEL-1678's numbers (605-613px at 30px, desktop reflow about 30px) are that lane's measurements; re-measure base first.
- Replacing `40ch` changes the sentence's measure. If the visual result differs noticeably from today's loaded-font rendering at any width, show before/after screenshots in light and dark and keep the loaded-font wrap identical where possible. If it cannot be kept identical, that is a design call: escalate with options.
- The placeholder polish item (one skeleton bar per line at 431-604px) is in scope only if it is cheap; otherwise file it as a follow-up.
