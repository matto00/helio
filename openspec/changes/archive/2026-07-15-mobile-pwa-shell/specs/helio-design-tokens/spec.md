## ADDED Requirements

### Requirement: Ratified phone breakpoint
The design system SHALL ratify a phone breakpoint of **430px** in `DESIGN.md` §4, extending the canonical
breakpoint set to 1440 / 1100 / 768 / 430, with a one-line rationale recorded in the document. CSS media
queries SHALL use only values from the canonical set; the pre-existing unratified `480px` query in
`PanelDetailModal.css` SHALL be folded into the ratified 430px value so no undocumented breakpoint values
remain in `frontend/`.

#### Scenario: DESIGN.md documents the phone breakpoint
- **WHEN** `DESIGN.md` §4 is read
- **THEN** the canonical breakpoint set includes 430px with a stated rationale

#### Scenario: No undocumented breakpoint values in media queries
- **WHEN** `frontend/` CSS media queries are grepped for max/min-width values
- **THEN** every value is one of 1440 / 1100 / 768 / 430, and `PanelDetailModal.css` uses 430px instead of 480px
