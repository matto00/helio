## MODIFIED Requirements

### Requirement: Desktop pipeline detail renders header, spine, editor and preview
Above the 768px phone boundary (`useIsPhoneShell()` false), `/pipelines/:id` SHALL render one compact header row, a left step spine whose width follows the page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: 270–340px at 1280×800 when the page has no live Output column, never narrower than 180px, and about 240px or more once the page leaves the centre column at least about 320px (growing to the 340px cap), and a centre column holding the selected step's editor above a preview table, plus a `live-output` grid track that holds the live Output column (capability `pipeline-live-output-column`) at about 340-380px when the page is wide enough for three columns and is zero-width otherwise. At or below 768px the page SHALL render the phone layout defined by the `pipeline-detail-mobile-layout` capability; the river view no longer exists.

From 769 to 1100px, in both themes and with the context list at its default or maximum width, every spine step title (trunk and lane rows) SHALL be readable: at least about 60px of it visible and unobscured, or the full title. Where the spine is narrow, a row MAY move its row count onto the summary line and show its ⋮ menu only on hover or keyboard focus (it stays reachable by keyboard); the phone layout is unaffected.

#### Scenario: Step titles readable at narrow desktop widths
- **WHEN** a pipeline with a lane is opened at any width from 769 to 1100px (8px steps), in light or dark, with the context list at 248px or 400px
- **THEN** every step title in the spine (trunk and lane rows) shows its full title or at least about 60px of it, not covered by another element, and the header and editor-action checks still pass

#### Scenario: Desktop layout
- **WHEN** a user opens a pipeline at 1280×800
- **THEN** the header, the spine, the focused editor and the preview table are rendered, and no Steps/Outputs tab strip and no footer bar are rendered

#### Scenario: Phone layout unchanged
- **WHEN** the same pipeline is opened at 390px wide
- **THEN** (scenario name kept for archive; the phone layout is no longer the river) the phone header, the Steps / Preview / Runs tabs, the step list and the floating run pills render, and no river view, no Outputs tab and no footer bar are rendered
