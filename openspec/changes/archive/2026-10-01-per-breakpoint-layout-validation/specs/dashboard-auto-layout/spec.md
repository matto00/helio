## REMOVED Requirements

### Requirement: Auto-layout persists identically across all four responsive breakpoints

**Reason**: Copying one packed placement to every breakpoint overflowed the 2-column xs grid (HEL-1071).
**Migration**: See "Auto-layout packs each breakpoint at its own column count".

## ADDED Requirements

### Requirement: Auto-layout packs each breakpoint at its own column count

The endpoint SHALL accept an optional `breakpoint` (`lg|md|sm|xs`). When omitted, it SHALL pack every breakpoint independently at that breakpoint's own column count (`lg` at `cols`, default 12; request `w` is expressed in `cols` units and scaled to each other breakpoint, then clamped to `[1, breakpoint cols]`) and persist all four. When given, it SHALL pack only that breakpoint (request `w` in that breakpoint's units; `cols`, if supplied, must equal the breakpoint's column count else `400`) and leave the other breakpoints untouched. No packed item SHALL exceed its breakpoint's column count, per-kind minimum widths notwithstanding. Panels omitted from the request SHALL keep their stored position in each packed breakpoint and packed items SHALL be placed below them, never overlapping them. The result is subject to the layout-validation rules (`400`, nothing saved, if a packed breakpoint is invalid, e.g. omitted stored panels already overlap).

#### Scenario: xs never overflows
- **WHEN** an auto-layout request packs three Output panels of width 4 with no `breakpoint`
- **THEN** every stored `xs` item has `x + w <= 2` and no two `xs` items overlap

#### Scenario: Single breakpoint leaves the others alone
- **WHEN** a request with `breakpoint: "xs"` succeeds
- **THEN** `lg`, `md`, `sm` are byte-identical to before

#### Scenario: Packed items do not overlap kept panels
- **WHEN** a dashboard has an omitted panel at the top of `lg` and a request packs two others
- **THEN** the packed items sit below the kept panel in every packed breakpoint
