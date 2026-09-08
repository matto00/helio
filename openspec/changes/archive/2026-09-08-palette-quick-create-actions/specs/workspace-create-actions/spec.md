## ADDED Requirements

### Requirement: Create-action seams are consumable by surfaces other than empty states
Each workspace create-action seam SHALL be consumable by any surface that offers creation, not only by an
empty state, and every such consumer SHALL obtain creation behavior from the seam rather than reimplementing
it. Where a consumer's needs exceed a seam's current shape, the seam SHALL be extended rather than
duplicated, so a resource never acquires two divergent creation paths.

#### Scenario: A second consumer reuses the same seam
- **WHEN** a surface other than an empty state offers creation of a workspace resource
- **THEN** it invokes that resource's existing create-action seam, and no second creation path for that
  resource exists

#### Scenario: Availability rules travel with the seam
- **WHEN** a seam reports that its action is unavailable — such as panel creation with no dashboard selected
- **THEN** every consumer of that seam reflects the same unavailability, without restating the rule itself
