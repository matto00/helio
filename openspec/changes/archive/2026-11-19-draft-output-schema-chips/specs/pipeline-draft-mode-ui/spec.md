## ADDED Requirements

### Requirement: Draft step preview schema chips match the draft grid
While a draft exists and the "Rows after step N" grid shows a draft frame for the step, the "Output schema" chips above
it (inline chips, or the field-count disclosure for a large schema) SHALL list exactly the grid's columns, with the same
names, in the same order, and each field SHALL carry the same type the grid's header caption shows. A column the shown
step's draft rename produced SHALL carry the type of the column it was renamed from when that type is known; any other
column the saved analysis does not name (for example a renamed column on a step below the rename) SHALL carry the type
inferred from the draft rows. Deriving the chips SHALL send no network request. When the step shows no draft grid (the
step is off, it is not previewed, or its first draft computation is pending), the chips SHALL show the saved analyzed
output schema as before.

#### Scenario: A draft rename
- **WHEN** a draft renames `region` to `zone` in the shown step
- **THEN** the chips read the grid's headers in order, including `zone` and not `region`, the `zone` header shows the
  type `region` had, and no request is sent by the edit

#### Scenario: A large draft schema
- **WHEN** the draft frame has more columns than the inline-chip threshold
- **THEN** the field-count disclosure counts and lists the draft columns in the grid's order

#### Scenario: A step below a draft rename
- **WHEN** a draft renames `region` to `zone` and the shown step is a filter below the rename
- **THEN** the chips include `zone`, and its grid header shows the type inferred from the draft rows

#### Scenario: No draft grid shown
- **WHEN** a draft exists but the step shows no draft grid (the draft turned the step off, it is not previewed, or its
  first draft computation is pending)
- **THEN** the chips show the saved analyzed output schema

#### Scenario: An empty draft frame
- **WHEN** the draft grid is shown but its frame has zero rows (for example a draft filter that matches nothing)
- **THEN** the chips show the saved analyzed output schema, so the chip group does not disappear while a schema is known, and the empty grid keeps its existing empty state
