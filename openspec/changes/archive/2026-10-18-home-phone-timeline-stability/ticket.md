# HEL-1665: Home on phones after HEL-1642: stop the ~31px timeline shift on load, and keep the timeline usable on short phones (375×667)

## Description

origin_kind: followup
origin_ticket: HEL-1642 (PR matto00/helio#1062, merged as 08e65e17e)

1. **Layout shift (pre-existing).** Home's run timeline jumps about 31px down on load when the shelf heading's "All N →" link appears. Reserve the link's slot, or render it with the skeleton, so the timeline doesn't move.
2. **Short phones.** At 375×667, the timeline's top (563.8px) clears the bottom nav's top (599px), but most of the timeline card sits behind the nav. Decide on a short-phone bound, for example a smaller shelf thumbnail below about 700px of height, so at least the timeline heading and first row are visible above the nav.

Parent: HEL-1570 (redesign epic). Related: HEL-1642.

## Acceptance Criteria

- On load, the timeline moves by 0px, measured.
- At 375×667, the timeline heading and first row are fully above the nav, in light and dark.
- Each AC has an e2e test that fails first.

## Driver constraints (overnight run)

- DESIGN.md binding; compare against the running app at 375×667, 375×812, 430×932 and desktop (1280) — Home desktop unchanged — light and dark; layout-shift probe; screenshots persisted in scratch `/home/matt/Development/helio/.concertino/scratch/HEL-1665/`.
- Keep HEL-1642's measurements and `e2e/hel1642-home-phone-timeline.spec.ts` green.
- Out of scope: HEL-1666 (HomePage.css split/tidy); pipeline-page files (HEL-1668) and accent hover tokens (HEL-1669).
- Reversible UI decisions are listed in the PR body under "UI decisions taken overnight".

## Scope for this run (orchestrator; item 2 resolved by owner ruling C3)

- **Item 1 (load shift): in scope.** Every content-independent mover is removed: the shelf head reserves the "All N" link's line, the skeleton cards match the loaded cards, the runs card head shows the legend while loading, and the opening line's placeholder is as many sentence lines as the default "All quiet: nothing has changed, failed or been missed." takes at that width (two lines at ≤430px, one line above — measured first). Bound: a loaded sentence with a different line count from the default still moves the timeline by the line difference (e.g. on phones a one-failed-run sentence is one line, so that common state still shifts by one line) (its length depends on the summary counts and cannot be known while loading). Recorded as a residual for the owner.
- **Item 2 (short phones): accepted as is (owner ruling).** AC2 is relaxed to: at 375×667 the timeline heading and the top of the first row are visible above the nav; scroll for the rest (light and dark). No short-phone layout change is built.
- **Disposition.** The PR closes HEL-1665 with a closing keyword (C3). Follow-ups are not filed by the run (driver rule); they are listed in the hand-back.
