## MODIFIED Requirements

### Requirement: Phone layout keeps the run timeline in the first viewport

In the phone layout (viewport width ≤430px) the dashboard shelf SHALL lay its cards out in two columns (up to four
cards in two rows), never one card per row, so that with four dashboards the top edge of the 24h pipeline-run timeline
SHALL be above the top edge of the phone bottom nav on first load (no scrolling) at 375×800 and 430×800 in both light
and dark themes. The shelf's loading skeleton SHALL use the same two-column arrangement, with card placeholders sized to the loaded
cards' thumbnail aspect ratio (within a few px of a loaded card's height). The page SHALL render without
horizontal scroll at 430px as well as at the widths the designed-states requirement lists.

Once the web fonts have loaded, from Home's loading skeletons to its settled state, neither the pipeline-run timeline card's top edge nor
the top of its content (the loading skeleton, then the timeline) SHALL move (0px, measured) at phone widths and at
desktop width, in light and dark themes, in either order in which the dashboards list and the home summary resolve,
for a user with dashboards, pipelines and the default opening sentence ("All quiet: …"): the shelf heading SHALL be the same height in
every state, the shelf's skeleton cards SHALL be the same height as the loaded cards, the timeline card's heading SHALL
show the status legend while loading, and the opening line's placeholder SHALL be the default opening sentence itself, hidden, so it is the height of that
sentence at every width and under every type style (under Mono the default sentence is two lines at 1280
and the placeholder wraps likewise; measured 0px in Sans, Serif and Mono at 375×667 and 1280×900). When the loaded opening sentence has a different number
of lines from the default at that width, the timeline MAY move by the
height of the line difference only; when the loaded summary has no pipelines, the legend MAY disappear. Every Home
section-head link SHALL keep a touch target of at least 44×44px on a coarse pointer or at ≤768px, without growing its
heading's height. For a user with dashboards, Home's settled layout at desktop width (1280px, fine pointer) SHALL be
unchanged by these rules; with zero dashboards the shelf heading MAY be up to the link's line-box difference taller.
On a short phone (375×667) in light and dark, the pipeline-run timeline's heading and the top of its first row SHALL be
visible above the bottom nav's top edge on first load without scrolling; the rest of the timeline is reached by scrolling
(owner ruling: item 2 accepted as is, no short-phone layout change).
The rule does not cover the residual cold-load web-font swap: when the heading and mono fonts arrive the runs card MAY
move by an amount that depends on the platform's fallback font. Measured (runs card top spread before the web fonts
arrive; base 647734111 versus this change): 2-4px on base; with this change 3-4px locally and, with DejaVu Sans as the
fallback (as on CI), 8px at 375-540px and 22-24px at 620-1280px, where the hidden default sentence wraps in the wider
fallback font. Only a `size-adjust` fallback could remove it. This is recorded in the e2e evidence, not asserted.

#### Scenario: Timeline visible at 375px
- **WHEN** a user with four dashboards and at least one pipeline opens `/home` at 375×800, in light or dark theme
- **THEN** the shelf shows its four cards as two rows of two, and the run timeline's top edge is above the bottom nav's top edge without scrolling

#### Scenario: Timeline visible at 430px
- **WHEN** the same user opens `/home` at 430×800, in light or dark theme
- **THEN** the shelf shows two rows of two cards, the run timeline's top edge is above the bottom nav's top edge, and the document does not scroll horizontally

#### Scenario: Timeline does not move on load
- **WHEN** a user with four dashboards, at least one pipeline and the default opening sentence opens `/home` while the dashboards list and the home summary are still loading, at 375×667, 375×812, 430×932, 480×900, 540×900 or 1280×900, in light or dark theme, with the two responses arriving in either order
- **THEN** neither the run timeline card's top edge nor the top of its content moves (0px) at any point between the loading state and the settled state with the "All N" link shown

#### Scenario: A longer opening sentence moves the timeline by its extra line only
- **WHEN** a user's loaded opening sentence is three lines at 375px (one more than the default there)
- **THEN** the timeline's content moves by one sentence line and by nothing else

#### Scenario: Timeline heading and first row start above the nav on a short phone
- **WHEN** a user with four dashboards and at least one pipeline opens `/home` at 375×667, in light or dark theme
- **THEN** the bottom of `#home-runs-heading` and the top of the first `.tl-disc__head` are above the bottom nav's top edge without scrolling, and the rest of the timeline is reached by scrolling

#### Scenario: Section-head link keeps its touch target
- **WHEN** Home renders on a coarse pointer or at ≤768px wide
- **THEN** the "All N" shelf link and the "+N more" runs link each have a hit region of at least 44×44px
