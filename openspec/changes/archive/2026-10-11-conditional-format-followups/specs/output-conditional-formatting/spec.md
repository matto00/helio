## ADDED Requirements

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
