## ADDED Requirements

### Requirement: Field-or-literal control supports a multiline literal input

`BoundOrLiteralField` SHALL accept an optional `literalMultiline` prop; when `true`, the literal-mode
input SHALL be a multiline textarea instead of a single-line text field. Omitting the prop SHALL preserve
today's single-line behavior for existing callers (Metric's Label/Unit controls).

#### Scenario: Text's Content control uses a multiline literal input
- **WHEN** the Text panel's Content control is rendered with `literalMultiline: true` and mode is "Fixed
  text"
- **THEN** a multiline textarea is shown for the literal value instead of a single-line text field

#### Scenario: Metric's Label/Unit controls are unaffected
- **WHEN** Metric's Label or Unit control is rendered (no `literalMultiline` prop passed)
- **THEN** the literal-mode input remains a single-line text field, unchanged from today

### Requirement: Text is the pattern's first non-Metric consumer

The Text panel's Content control SHALL directly consume this capability's reusable contract
(`BoundOrLiteralField` + `useBoundOrLiteralState`), without re-deriving the mode-toggle interaction model
or the mode-default heuristic.

#### Scenario: Text's Content control reuses the mode-default heuristic
- **WHEN** a Text panel with an existing literal `config.content` (and no `fieldMapping.content`) opens
  its Content control
- **THEN** the mode toggle defaults to "Fixed text" (Static), matching `defaultBoundOrLiteralMode`'s
  existing literal-is-set heuristic
