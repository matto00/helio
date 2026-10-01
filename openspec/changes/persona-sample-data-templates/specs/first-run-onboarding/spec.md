## ADDED Requirements

### Requirement: Persona template chips
The empty-workspace first-run surface SHALL offer one chip per persona as a "no file? start from a template" choice. Chips SHALL be keyboard-operable with accessible names; progress SHALL be announced via a polite live region and failures via an alert. Choosing a chip SHALL emit `firstrun_template_chosen` with the slug and navigate to the built dashboard.

#### Scenario: Choose a persona
- **WHEN** a user activates a persona chip
- **THEN** the event is tracked, a dashboard is built, and the app navigates to it

#### Scenario: Failure
- **WHEN** instantiation fails
- **THEN** an alert with a retry is shown and the chips remain usable
