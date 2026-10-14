## MODIFIED Requirements

### Requirement: EmptyState renders an intent-error variant with an alert role
The `EmptyState` component SHALL accept an `intent` prop (`"neutral" | "error"`, default `"neutral"`).
When `intent="error"`, on both the `main` and `sidebar` variants: the icon-wrap SHALL use a solid
error-tinted background (mixed against the opaque surface token, not a translucent wash alone) and an
error-tinted border, instead of the default accent tint and neutral border; the icon glyph itself SHALL
also render in the error intent color, not the default accent color; the root element SHALL carry
`role="alert"` and SHALL NOT carry `aria-label` (the live region's own content already announces the
title, so a separate `aria-label` would double-announce it). The `main` variant's title SHALL remain
rendered in the heading face (`--font-heading`) exactly as the `neutral` intent does.

#### Scenario: Error intent applies intent-error tokens, glyph color, and an alert role
- **WHEN** `EmptyState` is rendered with `intent="error"`
- **THEN** the icon-wrap element and its glyph carry error-tinted styling instead of the accent tint
- **AND** the root element carries `role="alert"` and no `aria-label`

#### Scenario: Neutral intent is the default and unchanged
- **WHEN** `EmptyState` is rendered with no `intent` prop
- **THEN** it renders identically to its pre-existing (accent-tinted, role-less, `aria-label`-carrying)
  behavior
