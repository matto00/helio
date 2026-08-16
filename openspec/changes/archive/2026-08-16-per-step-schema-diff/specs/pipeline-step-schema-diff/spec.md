# pipeline-step-schema-diff Specification

## ADDED Requirements

### Requirement: Per-step schema diff is computed client-side from analyze schemas
The frontend SHALL provide a pure helper that, given a step's analyze `inputSchema` and
`outputSchema` (and, for the `rename` op, its `renames` config map), computes:
- **added** columns: present in the output schema only
- **dropped** columns: present in the input schema only
- **retyped** columns: present in both schemas under the same name with a different type
- **renamed** columns: paired old→new names, determined only from the `rename` op's config map
  where the old name is otherwise dropped and the new name otherwise added; rename pairs SHALL be
  reported as renames, not as an add plus a drop. For any other op, or any unpaired entry, the
  columns remain in added/dropped.

The helper SHALL be pure (no React, no I/O) and SHALL derive everything from the existing analyze
response — no new backend call and no wire change.

#### Scenario: Added, dropped, and retyped columns are classified
- **WHEN** the input schema is `[a: string, b: number, c: string]` and the output schema is
  `[a: string, c: number, d: string]`
- **THEN** the diff reports `d` added, `b` dropped, and `c` retyped (string→number), with `a`
  in no bucket

#### Scenario: Rename op pairs old and new names as a rename
- **WHEN** a `rename` step's config maps `b` to `b2`, `b` exists in the input schema, and `b2`
  exists in the output schema
- **THEN** the diff reports `b → b2` as renamed, and neither `b` as dropped nor `b2` as added

#### Scenario: Non-rename ops never report renames
- **WHEN** any non-`rename` step drops column `b` and adds column `b2`
- **THEN** the diff reports `b` dropped and `b2` added, and the renamed bucket is empty

#### Scenario: Identical schemas produce an empty diff
- **WHEN** the input and output schemas are identical (including the backend's
  validationError identity fallback where outputSchema equals inputSchema)
- **THEN** every diff bucket is empty

### Requirement: StepCard renders the real schema diff as chips on every op kind
The StepCard component SHALL render the computed schema diff as chips in the expanded card body
for every step op kind (not only the no-editor fallback branch), replacing the previous hardcoded
placeholder chips (`+ col_a`, `− col_b`, `~ col_c`), which SHALL be removed. The chips SHALL:
- Use the existing step-card diff chip styling, with distinct presentations for added (`+ name`),
  dropped (`− name`), retyped (`~ name: fromType→toType`), and renamed (`oldName → newName`)
- Render nothing (no empty container) when the diff is empty or analyze data for the step is
  unavailable

#### Scenario: Real diff chips replace the placeholder
- **WHEN** a step's analyze data is available and its output schema differs from its input schema
- **THEN** the expanded StepCard shows chips reflecting the actual added/dropped/retyped/renamed
  columns, and the hardcoded `col_a`/`col_b`/`col_c` placeholder chips do not appear anywhere

#### Scenario: Diff chips appear for ops with dedicated editors
- **WHEN** a step whose op kind has a dedicated config editor (e.g. `select`) drops a column
- **THEN** the expanded StepCard shows the corresponding dropped chip alongside the editor

#### Scenario: No chips when there is nothing to show
- **WHEN** a step's diff is empty, or analyze data for the step is unavailable (pending, failed,
  or unknown step id)
- **THEN** the expanded StepCard renders no diff chips and no empty diff container
