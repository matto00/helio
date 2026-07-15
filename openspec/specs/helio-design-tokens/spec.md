# helio-design-tokens Specification

## Purpose
CSS custom property token system for the Helio design system: type scale, semantic typography roles, spacing scale, brand tokens, mono font, and utility classes.
## Requirements
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

### Requirement: Sidebar search inputs use token-based sizing
Sidebar filter/search inputs (DashboardList, PanelList, TypeRegistry) SHALL have a height of 28 px and font-size of `var(--text-xs)` (0.75 rem).

#### Scenario: Filter input height and font-size are normalized
- **WHEN** the sidebar renders a search or filter input
- **THEN** the input SHALL have a computed height of 28 px and font-size of 0.75 rem

### Requirement: Icon buttons are consistently sized across sidebar list components
Icon-action buttons in DashboardList header actions, PanelList card action buttons, and TypeRegistry action buttons SHALL be consistently sized (24 × 24 px).

#### Scenario: DashboardList header action buttons are 24x24
- **WHEN** the DashboardList header renders action buttons (add, etc.)
- **THEN** each icon button SHALL be 24 px wide and 24 px tall

#### Scenario: PanelList card action buttons are 24x24
- **WHEN** a panel card renders its action (three-dot menu) button
- **THEN** that button SHALL be 24 px wide and 24 px tall

### Requirement: Dead dashboard-list__collapse class is removed
The `dashboard-list__collapse` CSS class SHALL NOT exist in DashboardList.css, as the collapse button was moved to App.tsx.

#### Scenario: Collapse class is absent from DashboardList stylesheet
- **WHEN** DashboardList.css is loaded
- **THEN** no CSS rule for `.dashboard-list__collapse` SHALL be present

### Requirement: Nav-link and eyebrow text use design token values
The `.app-sidebar__nav-link` and any eyebrow labels in the sidebar SHALL use design token values for font-size rather than hardcoded pixel or rem values.

#### Scenario: Nav-link font-size references a token
- **WHEN** the sidebar renders navigation links
- **THEN** the nav-link font-size SHALL be expressed as a CSS custom property reference (e.g., `var(--text-xs)` or `var(--eyebrow-size)`)

### Requirement: Ratified phone breakpoint
The design system SHALL ratify a phone breakpoint of **430px** in `DESIGN.md` §4, extending the canonical
breakpoint set to 1440 / 1100 / 768 / 430, with a one-line rationale recorded in the document. CSS media
queries SHALL use only values from the canonical set; the pre-existing unratified `480px` query in
`PanelDetailModal.css` SHALL be folded into the ratified 430px value so no undocumented breakpoint values
remain in `frontend/`.

#### Scenario: DESIGN.md documents the phone breakpoint
- **WHEN** `DESIGN.md` §4 is read
- **THEN** the canonical breakpoint set includes 430px with a stated rationale

#### Scenario: No undocumented breakpoint values in media queries
- **WHEN** `frontend/` CSS media queries are grepped for max/min-width values
- **THEN** every value is one of 1440 / 1100 / 768 / 430, and `PanelDetailModal.css` uses 430px instead of 480px

