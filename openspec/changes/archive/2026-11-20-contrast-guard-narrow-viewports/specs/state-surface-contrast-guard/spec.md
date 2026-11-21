## ADDED Requirements

### Requirement: The guard measures the redesign's narrow layouts
The state-surface contrast guard SHALL measure hover and focus states at viewport widths of 1440, 1100, 768 and
390 px, in both themes, on the routes whose rendered layout differs at those widths (at 1100 px the home and
connectors pages; at 768 and 390 px the pipeline detail, dashboards, home and connectors pages), including the
chrome that renders only at those widths (phone command bar, phone section title, phone section links, dashboard chip
row, bottom navigation tabs). The only hover exemption at narrow widths is the glass bottom-navigation tab, whose
hover design is deferred to a follow-up; its focus state SHALL still be measured. An element is stamped only once it is visible and enabled, so a cell SHALL wait for its route's
asynchronously enabled controls before stamping.

Narrow-width measurement SHALL use a hover-capable pointer, because hover styles are only applied where the primary
pointer can hover; layouts SHALL be selected by viewport width. Every visible, enabled interactive element in a
narrow cell's rendered document SHALL be covered by one of that cell's views, or the cell SHALL fail naming the
uncovered element.

#### Scenario: A reintroduced invisible hover on the spine card fails at narrow widths
- **WHEN** the spine card's source-sample refresh button hover is reverted to the shared ghost hover that measured
  1.03:1 against the card in dark theme
- **THEN** the guard fails at 768 px and at 390 px, naming that button and its ratio

#### Scenario: A phone-only control with an invisible hover fails at 390
- **WHEN** a control that renders only in the phone shell, and has a hover rule, has its hover background set equal
  to its backdrop
- **THEN** the guard fails at 390 px, naming that control

#### Scenario: Phone-only controls show a hover a mouse user can see
- **WHEN** a hover-capable pointer hovers any control that renders only at 768 or 390 px other than a bottom
  navigation tab (including an active or inactive dashboard chip or phone section link, and the phone section title),
  in either theme
- **THEN** its hover background differs from its backdrop by at least the guard's threshold

#### Scenario: The unmutated application passes at every width
- **WHEN** the guard runs against the application as merged
- **THEN** every narrow-width cell passes in both themes

#### Scenario: An uncovered narrow-only control fails loudly
- **WHEN** a narrow cell's rendered document contains a visible interactive element that none of its views covers
- **THEN** the cell fails, naming the element
