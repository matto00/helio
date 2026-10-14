# design-language-v3 Specification

## Purpose
Defines what DESIGN.md v3 must state for the v0.9 re-design and the theme.css token contract that makes those statements true of the running app.

## Requirements

### Requirement: Sans + mono is the default type pairing
DESIGN.md SHALL state Schibsted Grotesk (UI and headings) plus JetBrains Mono (data, code, labels) as the default type pairing, and SHALL describe Fraunces only as an optional "Serif headings" type style. `theme.css` SHALL define a `--font-heading` token whose default value resolves to the sans family, and every heading role that previously used `--font-display` SHALL use `--font-heading`. `--font-display` SHALL remain defined as the serif face. No component SHALL hardcode a font family.

#### Scenario: Headings render in sans by default
- **WHEN** the app loads with no type-style preference, in either theme
- **THEN** a section page title (`.page-title`), the wordmark, the auth headline and a main EmptyState title compute a `font-family` whose first family is Schibsted Grotesk

#### Scenario: No CSS consumer reads the serif token directly
- **WHEN** `frontend/src` CSS is searched for `var(--font-display)`
- **THEN** the only consumer is the `--font-heading` indirection point (or none), so the serif face can be selected by setting one token

### Requirement: DESIGN.md defines a motion system backed by theme.css tokens
DESIGN.md SHALL contain a Motion section that names duration tokens, a stagger token and easing tokens, describes the primitives (staggered entrance, layout slide, value tween, crossfade, indicator slide) and states the Full / Subtle / Off setting rule, including that a user with no saved preference follows `prefers-reduced-motion`. Every motion token named in DESIGN.md SHALL be declared in `theme.css`.

#### Scenario: Every named motion token exists
- **WHEN** every `--motion-*` token name in DESIGN.md is extracted and checked against the declarations in `theme.css`
- **THEN** each one is declared in `theme.css`, and the check is a command whose output is recorded, not a reading

#### Scenario: Reduced motion is the default for an OS reduced-motion user
- **WHEN** a reader looks up what a user with no saved Motion preference and OS reduced motion gets
- **THEN** DESIGN.md gives a single unambiguous answer

### Requirement: DESIGN.md documents the shell and the live-preview pattern
DESIGN.md SHALL contain a Shell section covering the icon rail, the resizable and collapsible context list (with stated min/default/max widths and persistence), dashboard tabs (server-side TTL), the meta row that replaces a dashboard title, and `⌘K` as "search, jump, or ask". It SHALL contain a Live-preview section covering draft vs saved state, the "live" marker, and changed-row flashing. It SHALL state the accent-discipline rule and that every new surface works with any accent.

#### Scenario: A shell ticket can be reviewed against DESIGN.md alone
- **WHEN** a reviewer checks a rail, context-list, tab, meta-row or `⌘K` implementation
- **THEN** DESIGN.md states the rule for each without the reviewer needing to consult the design canvas

### Requirement: Forensics live in an appendix linked from the body
The measurement and contrast forensics (HEL-866 backdrop split, HEL-774 glass measurements, expander-tiling measurement narrative, HEL-1046/1048/1050 focus forensics, HEL-444 re-test) SHALL live in an appendix linked from the main body. Each moved block SHALL leave a pointer in its original section. The normative rules SHALL remain in the body, including the hit-expander tiling rule required by `design-doc-hit-expander-guidance`. No guard test SHALL be deleted or weakened.

#### Scenario: Every existing guard still passes
- **WHEN** the frontend Jest suite (including every `frontend/src/theme/*Guard*` test) and lint/typecheck run on the change
- **THEN** they pass with no guard test file removed and no guard assertion loosened

### Requirement: Dark theme uses the wider surface ramp
In the dark theme, `--app-bg` SHALL be `#0f0e0d` (the canvas every approved round-2 board paints), and every runtime copy of the dark canvas value (theme accessors, contrast-derivation surface sets, the selection-background base, the PWA dark theme colour) SHALL match it. `--app-surface` and the light-theme ramp SHALL be unchanged. Every text-token contrast floor and interactive-state contrast guard SHALL still pass, with no threshold or assertion changed.

#### Scenario: Contrast guards pass on the new canvas
- **WHEN** the theme guard tests and the state-surface contrast e2e guard run against the new dark canvas
- **THEN** they pass with no threshold or assertion changed, and `docs/contrast-audit.md`'s dark values are re-transcribed to match

#### Scenario: No stale copy of the old dark canvas remains
- **WHEN** `frontend`, `docs` and `openspec/specs` are searched for the old dark canvas value `#121110`
- **THEN** there are no matches
