## ADDED Requirements

### Requirement: Restored Output configs SHALL NOT reintroduce V117-repaired dead config keys
Whenever a patch-set undo or mid-apply rollback writes a previously captured Output config back to storage, the
backend SHALL first apply the same rename/drop mapping that migration V117 applies (HEL-1387), so the written config is
exactly what V117 would have produced from the config being written (the captured config for an undo recreate; the
stored config merged with the captured config for a mid-apply rollback). The journal itself SHALL NOT be rewritten.

#### Scenario: Undoing a pre-V117 step delete renames a dead metric label
- **WHEN** a `pipelineStep` delete journaled with a bound metric Output whose config holds `"metricLabel": "Revenue"`
  and no `label` is undone
- **THEN** the recreated Output's config holds `"label": "Revenue"` and no `metricLabel`

#### Scenario: Dead keys with no live equivalent are dropped on restore
- **WHEN** the journaled config of a restored table Output holds `tableDensity` and `columnWidths`
- **THEN** the recreated Output's config holds neither key and every other key is unchanged

#### Scenario: A non-null live key is never overwritten on restore
- **WHEN** the journaled config of a restored metric Output holds both `"label": "Live"` and `"metricLabel": "Old"`
- **THEN** the written config holds `"label": "Live"` and no `metricLabel`

#### Scenario: The restore mapping matches V117 exactly
- **WHEN** any Output kind and config is passed through V117's repair and through the restore-time normalisation
- **THEN** both produce the identical config
