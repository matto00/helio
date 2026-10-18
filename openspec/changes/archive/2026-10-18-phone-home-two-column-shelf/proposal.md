## Why

On a phone (≤430px) Home's dashboard shelf collapses to one column, so its four ~198px cards push the 24h pipeline-run timeline to ~1153px at 375×800 (1.34 viewports) and ~1.46 viewports at 430 (HEL-1583 measurement). Home exists to "see what ran and when, next to the dashboards it feeds"; on a phone the timeline is effectively off-screen.

## What Changes

- On the phone layout (≤430px) the dashboard shelf stays a **two-column** grid (the same 2×2 arrangement Home already uses between 431 and 1100px) instead of collapsing to one column, so all four cards stay visible and the run timeline's top lands inside the first viewport, above the floating glass bottom nav.
- The shelf skeleton (loading state) follows the same 2-column phone layout, and its thumbnail placeholder takes the real thumbnail's 16/7 aspect ratio instead of a fixed 96px, so skeleton cards are within a few px of loaded cards (the separate ~31px shift from the shelf heading's "All N →" link appearing on load predates this change and is out of scope).
- DESIGN.md's Home page entry records that the shelf stays two columns on phones.
- A new Playwright spec measures and pins the timeline position at 375 and 430px in light and dark, and asserts no horizontal page scroll.
- No change to ordering, the timeline, Needs attention, Up next, data, or any API.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `home-page`: adds a requirement that the phone layout keeps the run timeline's top in the first viewport (above the bottom nav) at 375 and 430px with a two-column shelf, and no horizontal scroll at 430px.

## Impact

- `frontend/src/features/home/ui/HomePage.css` (phone media query only).
- `frontend/src/features/home/ui/DashboardShelf.tsx` (skeleton thumbnail sizing) and `DESIGN.md` (one line).
- New `e2e/hel1642-home-phone-timeline.spec.ts`.
- `openspec/specs/home-page/spec.md` (via this delta).
- No backend, schema, migration, or API change.
