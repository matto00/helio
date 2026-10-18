## Why

After HEL-1642 Home's run timeline starts in a phone's first viewport, but two gaps remain: the timeline jumps ~31px
down when the shelf heading's "All N →" link mounts after the dashboards list loads (a visible layout shift on every
Home load on phones and coarse-pointer devices), and on a short phone (375×667) the timeline card's top barely clears
the floating bottom nav, so its heading-to-first-row content sits behind the nav.

## What Changes

- The shelf heading reserves the "All N →" link's line box in every state (a shelf-only `min-height`), so the shelf's
  height no longer changes when the link mounts. Separately, the section-head link's 44px touch floor moves from
  `min-height` (which grew the heading on touch) to DESIGN.md §3's sized `::after` expander.
- The shelf's skeleton cards match the loaded cards' height; the runs card shows its status legend while loading; the
  opening line's placeholder is the default sentence's height at that width (two lines on phones, one line above).
- Any other load-time mover the per-frame probe finds is removed within Home files.
- Item 2 (short-phone bound) was accepted as is by owner ruling (C3; AC2 relaxed, guard test added): every option needs a DESIGN.md §4 breakpoint amendment, a
  viewport-unit clamp, or a change to the shipped HEL-1642 phone shelf (design.md Decision 0).
- New e2e spec pinning item 1 (red against the pre-change code first). HEL-1642's spec stays green.
- DESIGN.md Home entry gains one sentence for the load-stable head.

## Capabilities

### New Capabilities

### Modified Capabilities
- `home-page`: the phone-layout requirement gains a load-stability rule (timeline moves 0px on load, with stated
  content bounds) and a 44px touch-target rule for section-head links.

## Impact

Frontend only: `frontend/src/features/home/ui/HomePage.css`, `DashboardShelf.tsx`, `PipelineRunsCard.tsx`,
`HomeOpeningLine.tsx` and their unit tests, a new Home CSS guard test, a new e2e spec, DESIGN.md. No API, schema or
backend change. Desktop (1280, fine pointer) settled layout is unchanged for a user with dashboards; with zero
dashboards the shelf heading is up to ≈6px taller (the reserved link line).
