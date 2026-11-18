## MODIFIED Requirements

### Requirement: Desktop pipeline detail renders header, spine, editor and preview
Above the 768px phone boundary (`useIsPhoneShell()` false), `/pipelines/:id` SHALL render one compact header row, a left step spine whose width follows the page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: 270–340px at 1280×800 when the page has no live Output column, never narrower than 180px, and about 240px or more once the page leaves the centre column at least about 320px (growing to the 340px cap), and a centre column holding the selected step's editor above a preview table, plus a `live-output` grid track that holds the live Output column (capability `pipeline-live-output-column`) at about 340-380px when the page is wide enough for three columns and is zero-width otherwise. At or below 768px the page SHALL render the phone layout defined by the `pipeline-detail-mobile-layout` capability; the river view no longer exists.

From 769 to 1100px, in both themes and with the context list at its default or maximum width, every spine step title (trunk and lane rows) SHALL be readable: at least about 60px of it visible and unobscured, or the full title. Where the spine is narrow, a row MAY move its row count onto the summary line; the phone layout is unaffected.

At every desktop width the spine SHALL follow one ⋮ (row/card menu) rule: the ⋮ of each Source card, each Output card and the selected step row is always visible and operable without hover; an unselected step row's ⋮ is shown on pointer hover or when keyboard focus is inside the row, and stays in the keyboard tab order while hidden. A hidden ⋮ SHALL NOT intercept a press meant for the row: with no-hover input (touch), a tap where an unselected row's hidden ⋮ sits SHALL select that row and SHALL NOT open its menu. With a hovering pointer the ⋮ is revealed before the press, and a click on it opens the menu. The selected row's always-visible ⋮ SHALL NOT cover the row's count or summary text and SHALL leave the title's readability floor above intact. A step row with no markers (no draft, saving, pending, error, stale, not-previewed, validation, warning or save-error marker) SHALL spend no width or gap on an empty markers slot.

#### Scenario: Step titles readable at narrow desktop widths
- **WHEN** a pipeline with a lane is opened at any width from 769 to 1100px (8px steps), in light or dark, with the context list at 248px or 400px
- **THEN** every step title in the spine (trunk and lane rows) shows its full title or at least about 60px of it, not covered by another element, and the header and editor-action checks still pass

#### Scenario: Compact rows are on where the spine is narrow
- **WHEN** a pipeline is opened at 769, 809, 849, 889, 929, 969 and 1009px with the context list at its default width
- **THEN** every step row is compact (its row count sits on the summary line), and at 1100px with the context list at its default width no step row is compact

#### Scenario: The selected row's ⋮ is visible without hover in compact mode
- **WHEN** a step is selected at a width where the spine rows are compact, and the pointer is away from the spine
- **THEN** the selected row's "Step actions" trigger is visible, receives a pointer press at its centre and opens the menu, and does not overlap the row's count or summary; the Source and Output cards' triggers are visible too; an unselected row's trigger is not visible until the row is hovered or focused

#### Scenario: No gap for an empty markers slot
- **WHEN** a compact step row has no markers
- **THEN** the horizontal gap between its summary and its row count is a single column gap, not two

#### Scenario: No width for an empty markers slot on one-line rows
- **WHEN** a pipeline is opened at 1100px with the context list at its default width (rows not compact) and a step row has no markers
- **THEN** the row's empty markers slot occupies no width and adds no flex gap between the title text and the row count

#### Scenario: A hidden ⋮ does not take a press meant for the row
- **WHEN** on a touch (no-hover) device, at a compact width or at 1100px, the user taps where an unselected step row's hidden ⋮ sits
- **THEN** that step is selected and no actions menu opens; a second tap on the now-visible ⋮ opens the step's actions menu

#### Scenario: Desktop layout
- **WHEN** a user opens a pipeline at 1280×800
- **THEN** the header, the spine, the focused editor and the preview table are rendered, and no Steps/Outputs tab strip and no footer bar are rendered

#### Scenario: Phone layout unchanged
- **WHEN** the same pipeline is opened at 390px wide
- **THEN** (scenario name kept for archive; the phone layout is no longer the river) the phone header, the Steps / Preview / Runs tabs, the step list and the floating run pills render, and no river view, no Outputs tab and no footer bar are rendered
