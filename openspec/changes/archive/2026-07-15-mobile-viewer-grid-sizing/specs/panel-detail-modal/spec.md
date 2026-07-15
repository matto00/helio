## ADDED Requirements

### Requirement: Detail modal is full-screen on phone and dismissible without hover
Below the 430px phone breakpoint (ratified in `DESIGN.md` §4) the panel detail modal SHALL render
full-screen. It MUST be dismissible without any hover-dependent target: a persistent, tappable close
control SHALL be visible, and existing dismissal paths (Escape, backdrop where applicable) remain.
Desktop and tablet (≥768px) modal presentation is unchanged.

#### Scenario: Phone viewport — modal is full-screen
- **WHEN** the panel detail modal opens below the 430px phone breakpoint
- **THEN** the modal occupies the full viewport

#### Scenario: Phone viewport — dismissible by tap
- **WHEN** the modal is open below the 430px phone breakpoint in view mode
- **THEN** a visible close control dismisses the modal on tap, with no hover required to reveal it

#### Scenario: Desktop presentation unchanged
- **WHEN** the modal opens at a viewport of 768px or wider
- **THEN** the modal presentation is unchanged from current behavior
