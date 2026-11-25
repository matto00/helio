## ADDED Requirements

### Requirement: The public viewer lays panels out from the stored layout
At a viewer container width of 768 px or more, the public viewer SHALL position panels from the panel-list
`layout` at the active breakpoint using the same grid configuration (breakpoints, columns, row height,
margins, density metrics) as the signed-in grid. The grid SHALL be read-only: no drag, resize, title edit or
menu affordance, and no layout save or layout repair request, even when the viewing session is the
dashboard's owner. Below 768 px the existing stacked list SHALL render.

#### Scenario: Two-column desktop layout
- **WHEN** a token viewer opens, at a 1440 px viewport (container about 1408 px, breakpoint md), a dashboard
  whose md layout places two panels side by side
- **THEN** the grid resolves breakpoint md and the two panels render side by side at md's stored positions

#### Scenario: Vertical gaps are kept
- **WHEN** the stored layout leaves an empty row band above a panel
- **THEN** that panel renders at its stored `y`, not pulled up

#### Scenario: Phone keeps the stack
- **WHEN** the same dashboard is opened at 375 px
- **THEN** the panels render in the stacked list

#### Scenario: No layout write from the public page
- **WHEN** the dashboard's owner opens their own share link and resizes the window across breakpoints
- **THEN** no `PATCH /api/dashboards/:id` and no `POST /api/dashboards/:id/layout/repair` request is sent

### Requirement: Content panels render their content publicly through the shared renderers
Text, markdown, image and divider panels SHALL render their content on the public viewer through the same
renderer components and the same sanitising and URL rules as the signed-in app. Hostile markdown and
hostile image URLs SHALL render inert.

#### Scenario: Markdown content
- **WHEN** a token viewer opens a dashboard with a markdown panel
- **THEN** the panel's rendered markdown is shown, not the word "markdown"

#### Scenario: Hostile content is inert
- **WHEN** a markdown panel contains a `<script>` tag, a `javascript:` link and a raw `<img onerror>`, and an
  image panel's URL is `javascript:alert(1)`
- **THEN** no script runs, no `javascript:` href or src is rendered, and the image panel shows its empty state

### Requirement: Form panels render a read-only preview publicly
A form panel on the public viewer SHALL render each bound field's label and control, using the field
declarations from the public form-schema route, with every control disabled and no submit control. No
interaction on the public viewer SHALL send a form submit request.

#### Scenario: Preview, never submit
- **WHEN** a token viewer opens a dashboard with a form panel and tries every control
- **THEN** the field labels are shown, every control is disabled, no submit button exists, and no request to
  `/api/panels/:id/submit` is sent
