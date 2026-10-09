## ADDED Requirements

### Requirement: Schema diff chips have unique keys when field names repeat
The schema diff chips SHALL render with unique React keys even when two diff entries in the same category share a
field name (for example several aggregate aliases left empty), so rendering logs no duplicate-key warning and every
entry still renders its own chip.

#### Scenario: Several empty aggregate aliases
- **WHEN** a step's output schema contains two or more added fields with the same name (e.g. `""`)
- **THEN** one chip renders per added field and React logs no duplicate-key warning
