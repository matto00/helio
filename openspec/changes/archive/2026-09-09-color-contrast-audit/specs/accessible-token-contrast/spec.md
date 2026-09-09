## Purpose

Guarantees that every colour token pair the application actually renders as text clears the WCAG AA contrast floor in both the light and dark themes, and that the audit backing that guarantee survives as a committed artifact rather than as run evidence.

## ADDED Requirements

### Requirement: Text token pairs clear WCAG AA in both themes

Every foreground token that renders as normal-size text SHALL measure at least 4.5:1 against every backdrop it can land on, in both the `dark` and `light` `data-theme` blocks. The backdrop set SHALL include the neutral surface tokens and the semi-transparent intent tints `--app-success-surface`, `--app-warning-surface` and `--app-error-surface`, the latter resolved as composites over each neutral parent they actually occur on — a tint is a `color-mix(..., transparent)`, so its rendered value depends on its parent and cannot be scored in isolation. A pair that measures below 4.5:1 SHALL either be corrected, or recorded as an explicit, justified exception naming why the pair does not render as normal-size text.

#### Scenario: A light-theme intent token fails against a surface it renders on

- **WHEN** `--app-error` is rendered as normal-size text on `--app-surface-soft` in the light theme
- **THEN** the measured contrast ratio is at least 4.5:1

#### Scenario: An intent token is rendered on its own semi-transparent tint

- **WHEN** `--app-error` is rendered as normal-size text on `--app-error-surface`, itself composited over a neutral surface
- **THEN** the ratio is measured against the resolved composite, not against the neutral surface alone, and is at least 4.5:1

#### Scenario: A pair measures below AA but never renders as text

- **WHEN** a foreground/surface pair measures below 4.5:1 and no rendered instance places that token as normal-size text on that surface
- **THEN** the pair is recorded as a documented exception with its measured ratio and the reason, and the token is left unchanged

#### Scenario: An exception rests on a claim that a pair never renders

- **WHEN** an exception is justified by the claim that the pair never renders as normal-size text
- **THEN** the exception names the specific enumeration performed — the DOM query and the routes and states visited — such that it can be re-run independently and reach the same result

### Requirement: A source-parsed guard fails CI on a contrast regression

A guard test SHALL parse the token values from `theme.css` source rather than from a transcribed copy, and SHALL fail when any covered pair drops below its threshold. The guard SHALL refuse to pass vacuously: it SHALL assert that the token and surface sets it parsed are non-empty, so a parse failure surfaces as a failure rather than as an empty pass.

#### Scenario: A token edit regresses a covered pair

- **WHEN** a token in either `data-theme` block is edited so a covered text pair falls below 4.5:1
- **THEN** the guard fails, and it fails in CI on the required check

#### Scenario: The guard cannot parse the theme source

- **WHEN** the guard parses `theme.css` and recovers no tokens, no surfaces, or no tint mix percentages
- **THEN** the guard fails rather than reporting a pass over an empty pair set or computing composites against a wrongly-defaulted base

### Requirement: The computed accent ink clears a contrast floor for every preset

`--app-accent-ink` SHALL clear the WCAG AA text floor of 4.5:1 against the accent it is placed on, for each of the shipped accent presets, in both themes. Selecting the better of two candidate inks without asserting a floor SHALL NOT satisfy this requirement.

#### Scenario: Every shipped preset is checked

- **WHEN** the accent ink is derived for each shipped accent preset
- **THEN** each derived ink measures at least 4.5:1 against its accent

### Requirement: The contrast audit is a committed artifact

The audit SHALL be recorded in a version-controlled document listing each audited pair, its measured ratio for each theme, the threshold applied, and its verdict. Run-local evidence under an ignored path SHALL NOT satisfy this requirement.

#### Scenario: A future token edit needs the prior measurements

- **WHEN** a contributor changes a colour token and needs to know the prior measured ratios
- **THEN** the contrast table is readable from the repository at a tracked path
