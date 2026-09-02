## REMOVED Requirements

### Requirement: Section-appropriate create action in the sheet
**Reason**: The create-action parity requirement is extended to explicitly cover Assistant, which previously had no create action while its desktop sibling did (HEL-789's surviving half); rewritten wholesale to state the new parity guarantee rather than leaving Assistant an implicit gap.
**Migration**: See the new "Section-appropriate create action in the sheet, with full desktop parity" requirement (this same change), which preserves every other create-action scenario (shared-hook flow, label/glyph source, single-affordance guarantee, tap-target floor, pending/failure states) unchanged.

## ADDED Requirements

### Requirement: Section-appropriate create action in the sheet, with full desktop parity
The mobile nav sheet SHALL offer a create action for every destination that has one on desktop, including Assistant ("New chat") — no destination's mobile entry point is silently dropped relative to desktop. Where a create action exists, it SHALL run the shared creation hook's flow, take its label and glyph from that hook, never show two create affordances at once, meet the 44px tap-target floor, and show a visible, human-readable failure if the create action fails without leaving a stale failure state or letting the sheet dismiss out from under a pending create — unchanged from the section's existing create-action behavior.

#### Scenario: Assistant has a mobile create action
- **WHEN** the mobile nav sheet renders the Assistant destination
- **THEN** a create ("New chat") action is present, matching desktop parity

#### Scenario: Create action runs the shared hook's flow
- **WHEN** the user activates a section's create action in the sheet
- **THEN** the same creation hook desktop uses for that section runs

#### Scenario: Never two create affordances at once
- **WHEN** the sheet renders a section with a create action
- **THEN** only one create affordance is shown for that section
