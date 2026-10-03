## Purpose
Defines how a pipeline join step names columns when the left and right inputs carry columns of the same name, so a join never silently drops a value.

## ADDED Requirements

### Requirement: A join never overwrites a left column with a right column
When a right-side column (other than the join key) has the same name as a left-side column, the join SHALL keep the left column under its original name and expose the right value under a deterministic prefixed name. It SHALL NOT raise an error and SHALL NOT drop either value.

#### Scenario: Same-named non-key column
- **WHEN** left rows have `{id, cnt}` and right rows have `{id, cnt}` and the join key is `id`
- **THEN** each joined row has `id`, `cnt` (left value) and `right_cnt` (right value)

### Requirement: The join key keeps a single copy
The join key column SHALL appear once, with the left value, and SHALL never be renamed.

#### Scenario: Key on both sides
- **WHEN** both sides carry the join key `id`
- **THEN** the output has exactly one `id` column and no `right_id`

### Requirement: Prefixed names are collision-proof and deterministic
The new name for a colliding right column `c` SHALL be `right_c`; if that name is already used by any left column, any non-colliding right column, or an earlier-renamed right column, a numeric suffix `_2`, `_3`, ... SHALL be appended to the smallest value that is free. Colliding right columns are processed in ascending (code-point) order of their original name, never in row/map iteration order (runtime rows are Maps, so no original column order exists), which makes the assigned names a pure function of the two column-name sets.

#### Scenario: Prefixed name already exists
- **WHEN** left has `{id, cnt, right_cnt}` and right has `{id, cnt}`
- **THEN** the right `cnt` is exposed as `right_cnt_2`

#### Scenario: Renames that would clash resolve in sorted-name order
- **WHEN** left has `{id, a, a_2, right_a}` and right has `{id, a, a_2, right_a}`
- **THEN** `a` is exposed as `right_a_2`, `a_2` as `right_a_2_2`, and `right_a` as `right_right_a`, regardless of the order the columns appear in

#### Scenario: Several collisions
- **WHEN** left has `{id, a, b}` and right has `{id, a, b}`
- **THEN** the output columns are `id, a, b, right_a, right_b`

### Requirement: Runtime and analyze-time schemas agree
Analyze-time schema inference for a join SHALL list exactly the set of columns (names; the inferred schema lists every left field first, then each surviving right field, renamed where it collided, in the right schema's own field order with the duplicate join key omitted) that the runtime row merge produces, including renamed columns.

#### Scenario: Parity
- **WHEN** a join with collisions is both analyzed and executed
- **THEN** the analyzed output column names equal the runtime row column names

### Requirement: Left join with no match
For a `left` join row with no right match, the row SHALL carry only left columns; the analyze-time schema SHALL still list the right-side (renamed) columns.

#### Scenario: Unmatched left row
- **WHEN** a left row has no right match under a `left` join
- **THEN** the row contains the left columns unchanged and no right or prefixed columns

### Requirement: Source-kind secondary inputs are resolved at analyze time
When a join's secondary input is a data source whose inferred schema is available, analyze SHALL use it so the renamed and right-only columns appear in the projected schema; when it cannot be resolved, analyze SHALL fall back to the left schema without error.

#### Scenario: Source-kind rename visible
- **WHEN** a join's right data source declares a column that collides with a left column
- **THEN** analyze projects the prefixed column

### Requirement: Spark joins use the same naming
The Spark execution path SHALL rename colliding right columns with the same rule before joining.

#### Scenario: Spark collision
- **WHEN** a Spark-executed join has a colliding non-key column
- **THEN** the output contains the left column and the prefixed right column, not two ambiguous same-named columns

### Requirement: Declared-but-absent left columns
A column declared in the analyze schema but absent from every left row SHALL NOT be renamed at runtime (nothing is overwritten); analyze MAY still rename it.

#### Scenario: Empty left input
- **WHEN** the left input has zero rows
- **THEN** runtime output is empty and no value is dropped
