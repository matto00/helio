## ADDED Requirements

### Requirement: Chart Annotation is a consumer of the field-or-literal pattern

The Chart panel's Annotation control SHALL consume this capability's reusable contract
(`BoundOrLiteralField` + `useBoundOrLiteralState` + `defaultBoundOrLiteralMode`) without re-deriving the
mode-toggle interaction model or the mode-default heuristic. The literal value SHALL persist to
`config.annotation` and the bound value to `fieldMapping.annotation`, matching the pattern's
"literal in a dedicated config field, binding in `fieldMapping.<slot>`" convention. Because charts already
carry `dataTypeId`/`fieldMapping`, the Chart Annotation slot needs no new binding infrastructure — unlike
the Text/Markdown/Image prerequisites documented elsewhere in this capability.

#### Scenario: Chart Annotation reuses the mode-default heuristic

- **WHEN** a chart panel with an existing literal `config.annotation` (and no `fieldMapping.annotation`)
  opens its Annotation control
- **THEN** the mode toggle defaults to "Fixed text", matching `defaultBoundOrLiteralMode`'s literal-is-set
  heuristic

#### Scenario: Chart Annotation defaults to bind-to-field when only a binding is set

- **WHEN** a chart panel with `fieldMapping.annotation` set and no literal `config.annotation` opens its
  Annotation control
- **THEN** the mode toggle defaults to "Bind to field" with the bound column selected
