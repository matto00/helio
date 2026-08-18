## ADDED Requirements

### Requirement: IconButton requires an accessible name at the type level
`shared/ui/IconButton` SHALL declare its `aria-label` prop as a required, non-optional `string` —
omitting it SHALL be a TypeScript compile error, not a runtime gap.

#### Scenario: Omitting aria-label fails to compile
- **WHEN** `IconButton` is used without an `aria-label` prop
- **THEN** the TypeScript build fails

#### Scenario: aria-label is rendered on the underlying button
- **WHEN** `IconButton` is rendered with `aria-label="Close"`
- **THEN** the rendered `<button>` has `aria-label="Close"`

### Requirement: IconButton shows a visible tooltip by default
`IconButton` SHALL render a native `title` attribute equal to its `aria-label` value unless a
distinct `title` prop is explicitly provided, in which case the explicit value SHALL be used instead.

#### Scenario: No title provided
- **WHEN** `IconButton` is rendered with `aria-label="Undo layout change"` and no `title` prop
- **THEN** the rendered `<button>` has `title="Undo layout change"`

#### Scenario: Explicit title overrides the default
- **WHEN** `IconButton` is rendered with `aria-label="Undo layout change"` and `title="Undo (Ctrl+Z)"`
- **THEN** the rendered `<button>` has `title="Undo (Ctrl+Z)"`

### Requirement: IconButton supports the ghost/secondary/danger recipes at documented sizes
`IconButton` SHALL support a `variant` prop of `"ghost" | "secondary" | "danger"` (default `"ghost"`)
and a `size` prop of `"xs" | "sm" | "md"` (default `"sm"`), mapping to DESIGN.md §3's control-height
tokens (`xs` → 24px dense-row exception, `sm` → `--control-sm`, `md` → `--control-md`) and §5's
existing Ghost/Secondary/Danger button recipes. No other variant or size value is supported.

#### Scenario: Default variant and size
- **WHEN** `IconButton` is rendered with no `variant`/`size` props
- **THEN** it renders the ghost recipe at `--control-sm` height/width

#### Scenario: Explicit secondary variant at md size
- **WHEN** `IconButton` is rendered with `variant="secondary"` and `size="md"`
- **THEN** it renders the hairline-bordered secondary recipe at `--control-md` height/width

### Requirement: Every icon-only interactive element has a visible or accessible tooltip/label
Every icon-only interactive element in the frontend SHALL have either a visible tooltip (a `title`
attribute) or an accessible name (`aria-label` or equivalent) — an icon-only control with neither
is a defect.

#### Scenario: Icon-only button with no accessible name is a defect
- **WHEN** an icon-only `<button>` is rendered with no `aria-label`, no `aria-labelledby`, and no
  `title`
- **THEN** it is a defect against this requirement, regardless of which component renders it
