## REMOVED Requirements

### Requirement: The checklist teaches the source-to-panel model in words and in glyphs
**Reason**: The four-step source → pipeline → type → panel model is retired along with DataTypes (HEL-903 decision 11). Rewritten wholesale rather than incrementally modified, since every scenario referenced the retired type concept.
**Migration**: See the new "The checklist teaches the source-to-output-to-dashboard model in words and in glyphs" requirement (this same change).

### Requirement: Each step's action opens that step's real creation flow
**Reason**: The step set itself changed (three steps, not four; "place them on a dashboard" replaces "create a panel"), so the flow-opening requirement is rewritten wholesale against the new step set rather than incrementally modified.
**Migration**: See the new "Each of the three steps' actions opens that step's real creation flow" requirement (this same change), which preserves this requirement's shell-mounted-vs-page-mounted distinction and precondition behavior against the new step set.

## ADDED Requirements

### Requirement: The checklist teaches the source-to-output-to-dashboard model in words and in glyphs
The checklist SHALL present exactly three steps — connect a source, shape it into outputs, place them on a dashboard — with every glyph derived from the nav section registry (not a bypass constant, closing HEL-794). The closing copy SHALL name all five nav destinations (Dashboards, Data Sources, Data Pipelines, Connectors, Assistant) so the icon-only mobile nav is fully covered (closing the surviving half of HEL-793).

#### Scenario: Three-step model replaces the four-step one
- **WHEN** the onboarding checklist renders
- **THEN** exactly three steps are shown: connect a source, shape it into outputs, place them on a dashboard
- **AND** no step references Types or Metrics

#### Scenario: Every step glyph comes from the section registry
- **WHEN** the checklist renders its step icons
- **THEN** each icon is read from `sections.ts`'s registry entries, not a separate hardcoded icon

#### Scenario: Closing copy names all five destinations
- **WHEN** the checklist reaches its closing/completion copy
- **THEN** the text names Dashboards, Data Sources, Data Pipelines, Connectors, and Assistant

### Requirement: Each of the three steps' actions opens that step's real creation flow
Each step's action SHALL open that step's real creation flow: a step whose flow is mounted at the shell (e.g. a modal) opens in place; a step whose flow is mounted elsewhere (e.g. a full page) navigates to that page. The checklist SHALL NOT set a page-mounted flow's own visibility flag directly. A step whose precondition is unmet SHALL remain unavailable rather than opening a broken flow. The third step's ("place them on a dashboard") action SHALL open the Output picker (or a dashboard on which the picker is available) — never the retired `PanelCreationModal`.

#### Scenario: A step whose flow is mounted at the shell opens in place
- **WHEN** the user activates a step whose creation flow is a shell-mounted modal
- **THEN** that modal opens without a route navigation

#### Scenario: A step whose flow is mounted elsewhere navigates to that page
- **WHEN** the user activates a step whose creation flow lives on its own page
- **THEN** the user is navigated to that page

#### Scenario: The checklist never sets a page-mounted flow's visibility flag
- **WHEN** a step's flow is page-mounted
- **THEN** the checklist only navigates; it does not toggle that page's own open/visible state directly

#### Scenario: An unmet precondition leaves a step unavailable
- **WHEN** a step's precondition (e.g. at least one source exists, for the "shape it into outputs" step) is not met
- **THEN** that step's action remains unavailable rather than opening a flow that would immediately fail

#### Scenario: Third step opens the Output picker
- **WHEN** the user activates the third onboarding step's action
- **THEN** the Output picker opens (directly, or via navigating to a dashboard where it can be opened)

### Requirement: Done button is styled correctly and provably so
The onboarding checklist's Done button SHALL be styled per DESIGN.md, and SHALL be covered by a regression test that asserts **computed** styles (`getComputedStyle` in jsdom, or an equivalent rendered probe) — a test asserting only text content or a class name is not sufficient (closing HEL-792's second half). The test SHALL be proven red against a deliberately broken style cascade before being trusted.

#### Scenario: Computed-style guard catches a broken cascade
- **WHEN** the Done button's governing CSS rule is deliberately removed (test setup)
- **THEN** the regression test fails
- **AND** restoring the rule makes it pass again
