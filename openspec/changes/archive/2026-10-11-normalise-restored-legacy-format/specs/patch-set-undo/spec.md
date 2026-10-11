## ADDED Requirements

### Requirement: Restored Output configs SHALL NOT reintroduce V118-repaired object-valued format
Whenever a patch-set undo or mid-apply rollback writes a previously captured Output config back to storage, the
backend SHALL apply migration V118's `format` mapping (HEL-1410) after V117's dead-key mapping, so the written config
is exactly what V117 followed by V118 would have produced from the config being written. The journal itself SHALL NOT
be rewritten, and no audit row is written for restore-time normalisation.

#### Scenario: Undoing a pre-V118 step delete maps an object format to a string format
- **WHEN** a `pipelineStep` delete journaled with a bound metric Output whose config holds
  `"format": {"prefix": "$", "decimals": 2}` and no `unit` is undone
- **THEN** the recreated Output's stored config holds `"format": "currency"` and no `unit` key is added

#### Scenario: Legacy format text moves into an absent unit on a metric
- **WHEN** the journaled config of a restored metric Output holds `"format": {"unit": "kg", "decimals": 0}` and no `unit`
- **THEN** the recreated Output's stored config holds `"format": "integer"` and `"unit": "kg"`

#### Scenario: A non-null live unit is never overwritten
- **WHEN** the journaled config of a restored metric Output holds `"unit": "live"` and `"format": {"unit": "kg"}`
- **THEN** the written config holds `"unit": "live"` and `"format": "number"`

#### Scenario: Collections get a string format and never a unit
- **WHEN** the journaled config of a restored collection Output holds `"format": {"suffix": "pts"}`
- **THEN** the written config holds `"format": "number"` and no `unit` key

#### Scenario: The restore format mapping matches V118 exactly
- **WHEN** any Output kind and config is passed through V118's repair and through the restore-time format normalisation
- **THEN** both produce the identical config
