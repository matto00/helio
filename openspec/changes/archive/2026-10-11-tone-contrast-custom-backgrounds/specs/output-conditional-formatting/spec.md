## MODIFIED Requirements

### Requirement: Rendering per Output kind
The tone colour SHALL come from `--app-success`, `--app-warning`, `--app-error` and their `-surface` washes, in
both light and dark themes. On a panel with a custom background colour, a tone's TEXT colour SHALL instead be a
readable variant of that token whenever the token would measure below 4.5:1 against the panel's resolved surface or
against any tone's wash over that surface (see "Tone text stays readable on a custom panel background").
- A metric Output's value SHALL render in the matched tone's text colour; its unit SHALL keep exactly the colour it
  has with no rules, including on a panel with a custom text/background colour.
- Each collection item SHALL evaluate the rules against its own value and render that value in the matched tone's
  text colour.
- A table cell matched by a `target: "cell"` rule for its column SHALL render tone text on the tone's `-surface` wash.
- A table row SHALL be washed with the tone's `-surface` when a `target: "row"` rule matches that row's value in the
  rule's column. Cell rules and row rules SHALL resolve independently (first match each); where both apply to one
  cell, the cell rule's tone SHALL decide that cell's text colour and wash, replacing (never layering over) the row
  wash on that cell. Each cell SHALL carry at most one wash, including pinned (sticky) cells.
- The metric delta/comparison line SHALL keep its own colouring, unaffected by rules.
- An Output with no rules SHALL render exactly as before this change, on the authenticated and public dashboard
  paths.

#### Scenario: Metric renders in the token colour in both themes
- **WHEN** a metric's rules match its value with tone `warning` on a panel with no custom background
- **THEN** its value's computed colour equals `--app-warning` in the light theme and in the dark theme

#### Scenario: Row and cell rules apply per column and per row
- **WHEN** a table has a row rule on `status` (`eq "failed"`, `error`) and a cell rule on `duration_s` (`gt 600`,
  `warning`)
- **THEN** every row whose `status` is `failed` is washed with `--app-error-surface`, every `duration_s` cell above
  600 shows warning text on `--app-warning-surface`, and other rows and cells are unstyled

#### Scenario: Delta colouring is unchanged
- **WHEN** a metric with a comparison delta also matches an `error` rule
- **THEN** the value renders in the error tone and the delta line keeps its up/down/flat colour

#### Scenario: Public dashboards render the same styling
- **WHEN** a shared dashboard shows a panel with no custom background bound to an Output with rules
- **THEN** the public viewer renders the same tones as the authenticated dashboard (the public viewer does not apply
  custom panel backgrounds, so it always shows the theme tokens)

## ADDED Requirements

### Requirement: Tone text stays readable on a custom panel background
On a panel whose appearance has a custom (non-transparent) background, each tone's text colour (metric and collection
figure, table cell text) and table tone mark SHALL measure at least 4.5:1 against the panel's resolved surface and
against every tone's `-surface` wash over it (a row-rule mark can sit on another tone's cell wash), in both themes. When the tone token already clears the implementation's internal target (4.55:1, a
rounding margin over the 4.5:1 contract), the token SHALL be used unchanged; otherwise a darker or lighter step of the same tone colour SHALL be used automatically. No editor warning
SHALL be shown. The tone glyph and the screen-reader label SHALL be unchanged. A panel with no custom background SHALL
render the tone tokens exactly as before.

#### Scenario: Tone text auto-adjusts on a saturated light-theme background
- **WHEN** a table cell rule matches with tone `error` on a light-theme panel whose background is `#ff0000`
- **THEN** the cell's text measures at least 4.5:1 against its washed background, its hue stays in the error family,
  and the glyph and sr-only label are the same as on a default panel

#### Scenario: A token that already passes is kept
- **WHEN** a metric matches tone `success` on a light-theme panel whose background is `#ffffff`
- **THEN** the value's computed colour equals `--app-success`

#### Scenario: Default panels are unchanged
- **WHEN** a panel has background `transparent`
- **THEN** no per-panel tone override is set and every tone renders in its theme token
