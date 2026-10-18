## ADDED Requirements

### Requirement: The output schema panel is placed by its real height
The output schema panel SHALL open above its trigger when its rendered height (content height, bounded by its CSS
cap) fits above, and otherwise on whichever side has more room, with its height capped to the room on that side. A
panel short enough to fit above SHALL never open below, on desktop or phone. On a phone page outside the step sheet
the room below SHALL end at the bottom navigation's top edge. Its width, edge margin and height cap SHALL come from
its CSS, not from literal pixel copies of it.

#### Scenario: Desktop panel opens above when its content fits above
- **WHEN** on desktop at 1280×800 and at 1000×800 a schema panel is opened whose content height fits in the room above
  its trigger while its 24rem cap does not
- **THEN** the panel is entirely above its trigger and inside the viewport

#### Scenario: Content taller than the room above
- **WHEN** a schema panel whose content is taller than the room above its trigger is opened
- **THEN** it opens on the side with more room, its height capped to that room, inside the viewport

#### Scenario: Short panel opens above when the cap would not fit
- **WHEN** a panel whose content is shorter than its cap is opened from a trigger with room above for its content but
  not for its cap
- **THEN** it opens above

#### Scenario: Phone panel clears the bottom nav
- **WHEN** the schema panel opens below its trigger on the phone page outside the sheet, at 375 and 768px, in light
  and dark
- **THEN** its bottom edge is above the bottom navigation's top edge (or the viewport edge where no bottom navigation
  is rendered)

### Requirement: The Output card names its source step clearly
The Output card SHALL describe what the Output reads as "from <step or lane subtitle>" (or "from the pipeline's
source"), never "off <step>".

#### Scenario: Output reading a step
- **WHEN** an Output reads the "Compute column" step
- **THEN** its card reads "from Compute column"
