## Purpose
Defines the single-definition rule for the eyebrow type recipe — that a component adopts the shared
utility rather than re-declaring it, that adoption happens only where it is computed-style-neutral,
and that any block deliberately left unconverted is recorded rather than silently skipped.

## ADDED Requirements

### Requirement: Consolidation onto the shared utility preserves rendering
Where a component stylesheet re-declares the eyebrow type recipe locally, it MAY adopt the shared
utility instead, and SHALL do so only where adoption is MEASURED to leave the element's computed
typography unchanged. Matching declared values is NOT sufficient evidence: replacing declarations
with a utility class can alter selector specificity and cascade position, so the winning declaration
may change even when every value matches. This capability does NOT prohibit a local copy: the binding design standard explicitly
permits either form, so a local copy is compliant and consolidation is an improvement rather than a
correction.

#### Scenario: A component that adopts the utility renders identically
- **WHEN** a component's local recipe is replaced by the shared utility
- **THEN** the element's computed typography is unchanged

#### Scenario: Consolidation does not alter the shared definition
- **WHEN** components are consolidated onto the utility
- **THEN** the utility and its tokens are unchanged

### Requirement: A block is converted only where conversion is computed-style-neutral
Adopting the utility SHALL NOT change an element's computed typography. Where a block declares fewer
properties than the recipe and inherits the remainder, the inherited value SHALL be compared against
what the utility would impose, and the block SHALL be converted only if they match. This comparison
SHALL be made by measuring rendered computed style, because an inherited value is produced by the
cascade and appears in no stylesheet source.

#### Scenario: Matching declared values is not sufficient for conversion
- **WHEN** a block declares the recipe's properties with the same values the utility would apply
- **THEN** its computed typography is still measured before and after, because replacing
  declarations with a utility class can change which declaration wins even when every value matches

#### Scenario: A block that cannot be measured is not converted
- **WHEN** a block's rendered state cannot be reached, or its selector matches no rendered element
- **THEN** it is left unconverted and recorded, rather than converted on an unverified assumption

#### Scenario: A block that would gain a differing weight is not silently converted
- **WHEN** a block declares no weight, inherits one, and the utility would impose a different weight
- **THEN** the block is not converted silently; the change is either justified or the block is left
  as it is

#### Scenario: A block with a genuinely different size is not converted
- **WHEN** a block declares a size the utility would not produce
- **THEN** it is not converted

### Requirement: Every unconverted block is recorded
A block left unconverted SHALL be recorded with its location and the reason. A consolidation that
reports only what it changed leaves the remainder invisible, and an unreviewable remainder becomes
debt rather than a decision.

#### Scenario: Skipped blocks are enumerated
- **WHEN** the consolidation leaves any block unconverted
- **THEN** each is listed with its file, its selector, and why it was left

#### Scenario: An ambiguous block is surfaced as a question rather than decided
- **WHEN** a block's intended relationship to the recipe is not determinable from the code
- **THEN** it is left unconverted and raised as an open question rather than resolved by assumption
