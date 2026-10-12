# output-conditional-formatting Specification

## Purpose
Threshold-based conditional formatting for metric, collection and table Outputs: an ordered list of rules stored in
the Output's `config.conditionalFormats` that colours matching values with the existing intent tokens, plus a
non-colour signal, on every dashboard surface that renders those Outputs (authenticated dashboard, fullscreen,
mobile stack and public shared dashboard) and in the Output editor's metric preview.

## Requirements

### Requirement: conditionalFormats rule shape
A metric, collection or table Output's `config` MAY carry `conditionalFormats`: `null` or a JSON array of at most 20
rule objects. A rule SHALL carry only the keys `op`, `value`, `value2`, `tone`, `label`, `column` and `target`.
- `op` SHALL be one of `gt`, `gte`, `lt`, `lte`, `between`, `eq`, `neq`.
- For `gt`, `gte`, `lt`, `lte` and `between`, `value` SHALL be a finite JSON number. For `between`, `value2` SHALL
  also be a finite JSON number with `value <= value2`; for every other operator `value2` SHALL be absent.
- For `eq` and `neq`, `value` SHALL be a finite JSON number or a JSON string of 1 to 200 characters after trimming
  (a whitespace-only string is rejected).
- `tone` SHALL be one of `success`, `warning`, `error`.
- `label`, when present, SHALL be a string of 1 to 60 characters after trimming.
- On a table Output, `column` SHALL be a non-empty string and `target`, when present, SHALL be `cell` or `row`
  (absent means `cell`). On a metric or collection Output, `column` and `target` SHALL be absent.

Inside a rule, an optional key (`value2`, `label`, `column` on metric/collection, `target`) whose value is JSON
`null` SHALL be treated as absent. `null` and `[]` SHALL both mean "no rules". A rule whose `column` names a column the Output's data does not contain
SHALL be accepted at write time and SHALL never match at render time.

#### Scenario: A valid list is stored and read back unchanged
- **WHEN** a table Output is created with `conditionalFormats: [{"column":"pass_rate","op":"lt","value":0.8,
  "tone":"error","label":"Failing"},{"column":"status","op":"eq","value":"failed","tone":"error","target":"row"}]`
- **THEN** the write succeeds and `GET /api/outputs/:id` returns the same list in the same order

#### Scenario: Clearing the rules
- **WHEN** an Output with rules is updated with `conditionalFormats: []` or `conditionalFormats: null`
- **THEN** the write succeeds and the Output renders exactly as an Output with no rules

### Requirement: Invalid rules are rejected at config validation
Every Output config write path that applies the per-kind known-key check (Output create, Output update, single-call
pipeline creation, pipeline-proposal grounding, and patch-set preview and apply of an Output update) SHALL reject a
`conditionalFormats` value that violates the rule shape with 400, naming `conditionalFormats`, the zero-based index of
the first offending rule and the reason; nothing SHALL be persisted. Restoring journaled prior config (patch-set
rollback, undo) SHALL NOT be subject to this check.

#### Scenario: Each malformation is rejected
- **WHEN** an Output write carries a rule with an unknown `op`, an unknown `tone`, a non-number `value` for `gt`, a
  `between` without `value2` or with `value > value2`, `value2` on a non-`between` rule, an unknown rule key, a
  non-array `conditionalFormats`, more than 20 rules, a table rule without `column`, or a metric rule with `column`
- **THEN** the response is 400, the message names `conditionalFormats` and the offending rule index, and the stored
  config is unchanged

#### Scenario: No rules leaves validation unchanged
- **WHEN** an Output write carries no `conditionalFormats` key
- **THEN** it is accepted or rejected exactly as before this change

### Requirement: Rule evaluation
Rules SHALL be evaluated against the raw value (before any `format` or `columnFormats` display formatting), in list
order, and the first matching rule SHALL decide the tone; a value no rule matches SHALL render with no conditional
styling. A raw value is numeric when, after trimming, it is non-empty and parses to a finite number.
- `gt`, `gte`, `lt`, `lte` SHALL compare numerically; `between` SHALL match `value <= x <= value2` (inclusive). A
  non-numeric raw value SHALL never match a numeric operator.
- `eq` and `neq` SHALL compare numerically when both the raw value and the rule `value` are numeric (a string rule
  `value` that is numeric by the definition above counts as numeric), and otherwise
  SHALL compare the trimmed strings case-insensitively.
- An empty or missing raw value SHALL match no rule, including `neq`.

#### Scenario: First match wins
- **WHEN** a metric's rules are `[{op:"lt",value:50,tone:"error"},{op:"lt",value:80,tone:"warning"}]` and its value
  is `42`
- **THEN** it renders with the `error` tone

#### Scenario: Raw value, not formatted text
- **WHEN** a metric with `format: "percent"` has value `0.75` and a rule `{op:"lt",value:0.8,tone:"error"}`
- **THEN** it renders `75%` with the `error` tone

#### Scenario: Text match
- **WHEN** a table cell in column `status` holds ` Failed ` and a rule is `{column:"status",op:"eq",value:"failed",
  tone:"error"}`
- **THEN** that cell renders with the `error` tone

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

### Requirement: Colour is not the only signal
Every value styled by a rule SHALL also render a glyph whose shape differs per tone (and from the delta direction
glyphs), hidden from assistive technology, and SHALL expose the rule's `label` (or, when absent, the tone word
"Good", "Warning" or "Critical") as visually hidden text read with the value and as a tooltip. For a row rule, the
glyph and text SHALL appear at the start of the row's first visible data cell, regardless of whether the rule's
column is visible and of any cell rule on that cell (a cell rule's own glyph and text stay in its own cell).

#### Scenario: Labelled rule
- **WHEN** a metric matches a rule with `label: "Failing"` and tone `error`
- **THEN** the value shows the error glyph, its accessible text includes "Failing", and hovering it shows "Failing"

#### Scenario: Row rule on a hidden column keeps a non-colour signal
- **WHEN** a table's `columnOrder` hides column `status` and a row rule `status eq "failed" → error` matches a row
- **THEN** the row is washed and its first visible data cell starts with the error glyph and "Critical" text

#### Scenario: Cell rule inside a washed row
- **WHEN** a row matched by an `error` row rule has a cell matched by a `warning` cell rule
- **THEN** that cell shows warning text on only `--app-warning-surface` (no error wash beneath it) and the other
  cells of the row show only `--app-error-surface`

#### Scenario: Unlabelled rule
- **WHEN** a table cell matches a `success` rule without a label
- **THEN** the cell shows the success glyph and its accessible text includes "Good"

### Requirement: Conditional formatting editor
The Output editor SHALL offer a "Conditional formatting" section for metric, collection and table Outputs, built from
the shared form primitives, that lists the rules in evaluation order and lets the author add, edit, remove and reorder
rules, choosing operator, value(s), tone, optional label and, for tables, column and target. Saving SHALL write the
list as `conditionalFormats`; removing the last rule SHALL write `[]`. The editor SHALL NOT allow saving a rule the
server would reject, and SHALL state that rules compare the raw value and the first match wins. The editor's metric
preview SHALL apply the unsaved rules. It SHALL be usable at 375px width.

#### Scenario: Author adds a rule and saves
- **WHEN** the author adds a table rule `pass_rate lt 0.8 → error` and saves
- **THEN** the PATCH body's `config.conditionalFormats` equals the rule list the server accepts, and the table
  re-renders with the rule applied

#### Scenario: Reordering changes precedence
- **WHEN** the author moves the second rule above the first and saves
- **THEN** the stored list order matches the editor order

### Requirement: Rules apply in the Output history rows view
The Output history view's stored-rows table SHALL apply the Output's CURRENT `conditionalFormats` rules to the stored
rows of the selected run, using the same raw-value evaluation, tone colours, glyphs and accessible text/tooltip as the
dashboard renderers. For a table Output, cell and row rules SHALL apply exactly as on the dashboard table. For a
collection Output, each stored row's value in the collection's mapped value column SHALL be evaluated against the rules
as that item would be on the dashboard. A metric Output's rules evaluate one headline value, not a row, and SHALL NOT
colour the stored rows. The changed-row highlight SHALL stay visible alongside rule styling: on a changed row, the "Change" cell SHALL keep
its text and `--app-accent-surface` background while the data cells show the rule styling. An
Output with no rules SHALL render the history rows exactly as before.

#### Scenario: Table rules colour history rows
- **WHEN** a table Output has a cell rule `duration_s gt 600 → warning` and the selected run's stored rows include a
  row with `duration_s` 900
- **THEN** that cell in the history rows table shows the warning glyph, warning text on `--app-warning-surface`, and
  its accessible text includes the rule's label or "Warning"

#### Scenario: Row rule composes with the changed-row highlight
- **WHEN** a row matched by a row rule is also new or changed versus the comparison run
- **THEN** the row's data cells show the rule's tone wash, and the "Change" cell still reads "New or changed" on
  `--app-accent-surface` (the change highlight is not hidden by the rule wash), in light and dark themes

#### Scenario: Collection rules apply to the value column
- **WHEN** a collection Output maps `value` to column `score` and has a rule `lt 50 → error`
- **THEN** each stored row whose `score` is below 50 shows the error glyph and "Critical" (or the label) in its
  `score` cell, and other cells are unstyled

#### Scenario: No rules, no change
- **WHEN** an Output has no `conditionalFormats`
- **THEN** the history rows table renders identically to before this change

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
