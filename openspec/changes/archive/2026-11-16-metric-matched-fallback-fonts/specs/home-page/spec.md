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
On a cold load (before the web fonts arrive) the page renders in metric-matched fallback faces, so when the
heading and mono fonts arrive the runs card top SHALL move by at most 4px at 375, 430, 480, 540, 620, 1024 and 1280px
wide, in light and dark themes, under the CI-like font set (Ubuntu noble with Liberation and DejaVu installed, as on CI's
e2e legs) and with DejaVu as the only fallback; at those widths the hidden default sentence SHALL have the same line
count in the fallback as in the web font. At other widths (for example the 605-615px band, where the default sentence
is close to its wrap point) the swap MAY be larger if the fallback wraps that sentence differently; the measured value
at 610px is recorded in the HEL-1678 evidence. The swap is asserted by the e2e at the listed widths as well as recorded
in its evidence; the measured numbers, base versus this change, are in the HEL-1678 change's evidence.
Under a larger browser default font size (Home is sized in rem) Home SHALL render without horizontal scroll at
375px and 1280px, and the 0px-after-fonts-load rule above SHALL hold.

#### Scenario: Timeline visible at 375px
- **WHEN** a user with four dashboards and at least one pipeline opens `/home` at 375×800, in light or dark theme
- **THEN** the shelf shows its four cards as two rows of two, and the run timeline's top edge is above the bottom nav's top edge without scrolling

#### Scenario: Timeline visible at 430px
- **WHEN** the same user opens `/home` at 430×800, in light or dark theme
- **THEN** the shelf shows two rows of two cards, the run timeline's top edge is above the bottom nav's top edge, and the document does not scroll horizontally

#### Scenario: Timeline does not move on load
- **WHEN** a user with four dashboards, at least one pipeline and the default opening sentence opens `/home` while the dashboards list and the home summary are still loading, at 375×667, 375×812, 430×932, 480×900, 540×900, 620×900, 1024×900 or 1280×900, in light or dark theme, with the two responses arriving in either order
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

#### Scenario: Cold-load web-font swap is bounded
- **WHEN** a user with four dashboards, at least one pipeline and the default opening sentence opens `/home` on a cold load at 375, 430, 480, 540, 620, 1024 or 1280px wide, in light or dark theme, under the CI-like font set (Liberation and DejaVu installed) or with DejaVu as the only fallback
- **THEN** the run timeline card's top edge moves by at most 4px between the first frame rendered in the fallback faces and the frame after the web fonts have loaded

#### Scenario: Larger browser default font size
- **WHEN** the browser's default font size is larger than 16px and the user opens `/home` at 375×812 or 1280×900, in light or dark theme
- **THEN** Home's text is rendered larger than at the default size, the document does not scroll horizontally, and the run timeline card does not move once the web fonts have loaded
