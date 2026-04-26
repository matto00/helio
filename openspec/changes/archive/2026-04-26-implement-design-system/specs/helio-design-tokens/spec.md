## ADDED Requirements

### Requirement: Type scale tokens
The system SHALL define a complete type scale as CSS custom properties in `theme.css` under `:root`, covering all sizes from `--text-micro` through `--text-3xl` as specified in the design handoff `colors_and_type.css`.

#### Scenario: Type scale tokens are present in root
- **WHEN** the app loads
- **THEN** CSS custom properties `--text-micro`, `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`, and `--text-3xl` SHALL all be defined on `:root`

### Requirement: Semantic typography role tokens
The system SHALL define semantic typography role tokens as CSS custom properties in `theme.css`, including at minimum `--h1-size`, `--eyebrow-size`, `--eyebrow-tracking`, and `--eyebrow-weight`.

#### Scenario: Semantic role tokens are present in root
- **WHEN** the app loads
- **THEN** CSS custom properties `--h1-size`, `--eyebrow-size`, `--eyebrow-tracking`, and `--eyebrow-weight` SHALL all be defined on `:root`

### Requirement: Spacing scale tokens
The system SHALL define a spacing scale as CSS custom properties in `theme.css` under `:root`, covering `--space-1` through `--space-10`.

#### Scenario: Spacing scale tokens are present in root
- **WHEN** the app loads
- **THEN** CSS custom properties `--space-1` through `--space-10` SHALL all be defined on `:root`

### Requirement: Brand and shape tokens
The system SHALL define `--app-radius-pill` as a CSS custom property in `theme.css` under `:root`.

#### Scenario: Pill radius token is present in root
- **WHEN** the app loads
- **THEN** CSS custom property `--app-radius-pill` SHALL be defined on `:root` with a value suitable for pill/capsule shaped elements (e.g., 9999px)

### Requirement: Mono font token
The system SHALL define `--font-mono` as a CSS custom property in `theme.css` under `:root` set to JetBrains Mono with appropriate fallbacks.

#### Scenario: Mono font token is defined
- **WHEN** the app loads
- **THEN** CSS custom property `--font-mono` SHALL be defined on `:root` with `"JetBrains Mono"` as the first value and monospace as the final fallback

### Requirement: Typography utility classes
The system SHALL provide `.eyebrow`, `.wordmark`, and `.mono` utility classes in `theme.css`.

#### Scenario: Eyebrow utility class exists
- **WHEN** an element has the class `eyebrow`
- **THEN** it SHALL apply `font-size: var(--eyebrow-size)`, `letter-spacing: var(--eyebrow-tracking)`, `font-weight: var(--eyebrow-weight)`, and `text-transform: uppercase`

#### Scenario: Mono utility class exists
- **WHEN** an element has the class `mono`
- **THEN** it SHALL apply `font-family: var(--font-mono)` and `font-variant-numeric: tabular-nums`

#### Scenario: Wordmark utility class exists
- **WHEN** an element has the class `wordmark`
- **THEN** it SHALL apply `letter-spacing: 0.14em` and `font-weight` appropriate for the wordmark

### Requirement: Mono font applied to panel metric and stat values
Panel components that display numeric metric or stat values SHALL use `var(--font-mono)` with `font-variant-numeric: tabular-nums`.

#### Scenario: Stat values render in mono font
- **WHEN** a panel displays a numeric metric or stat value
- **THEN** the value element SHALL have `font-family: var(--font-mono)` and `font-variant-numeric: tabular-nums` applied

### Requirement: Monospace contexts use font token
Components that previously used bare `font-family: monospace` SHALL be updated to use `var(--font-mono)` instead.

#### Scenario: Inline/code contexts use the token
- **WHEN** a component (TypeDetailPanel, ComputedFieldsEditor, AddSourceModal) renders a code or formula input
- **THEN** it SHALL use `font-family: var(--font-mono)` rather than the bare `monospace` keyword
