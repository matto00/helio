## REMOVED Requirements

### Requirement: Lookup op column collisions favor the brought-in reference value
**Reason**: HEL-1250 owner ruling: lookup follows join (HEL-1236) -- a brought-in column never overwrites a left column.
**Migration**: A requested column that collides with a left column is exposed as `right_<name>` (see the ADDED requirement); the original name keeps the left value.

## MODIFIED Requirements

### Requirement: Lookup op analyze-inference appends the requested columns with best-effort typing
The `analyze_pipeline` endpoint SHALL infer, for a `lookup` step, an output schema equal to the
input schema with each surviving requested column appended, named by the same collision rule the runtime applies (a requested column colliding with an input field is appended as `right_<name>`, never replacing the input field), each typed `string` as a documented best-effort unless a `lane`-kind secondary schema supplies the type -- the reference source's actual schema is
not resolved at analyze time for `source`-kind inputs. This is a dedicated dispatch case (not the unknown-op fallback), so `analyze_pipeline`
SHALL NOT emit a `validationError` for a pipeline containing a `lookup` step solely because of the
op type.

#### Scenario: Analyze appends the requested columns typed string
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "lookup", "config":
  {"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey": "code", "columns": ["label",
  "category"]}}` whose input schema contains fields `code` (string) and `qty` (integer)
- **THEN** the inferred output schema is exactly `code` (string), `qty` (integer), `label`
  (string), `category` (string) — and no `validationError` is present in the response

## ADDED Requirements

### Requirement: A lookup never overwrites a left column with a brought-in column
When a requested `columns` name equals a left-row column (other than the duplicate key, below), the lookup SHALL keep the left column under its original name and value, and expose the looked-up value under a deterministic prefixed name (`right_<name>`, then `right_<name>_2`, ... until free, colliding names processed in ascending code-point order, per the shared `JoinColumnNaming` rule). It SHALL NOT raise an error and SHALL NOT drop either value. Unmatched left rows carry `null` under the (renamed) brought names and keep every left value unchanged.

#### Scenario: Same-named column
- **WHEN** a lookup with `sourceKey` `code`, `lookupKey` `code`, `columns` `["qty"]` runs on rows `[{"code":"A","qty":5}]` against reference rows `[{"code":"A","qty":99}]`
- **THEN** the output rows are `[{"code":"A","qty":5,"right_qty":99}]`

#### Scenario: Unmatched row keeps the left value
- **WHEN** the same lookup runs on `[{"code":"Z","qty":5}]`
- **THEN** the output is `[{"code":"Z","qty":5,"right_qty":null}]`

#### Scenario: Several and pre-existing prefixed names
- **WHEN** left rows carry `{code, a, b, right_a}` and `columns` is `["a","b"]`
- **THEN** the brought `a` is exposed as `right_a_2` and `b` as `right_b`, independent of the order of `columns`

### Requirement: The duplicate lookup key keeps a single copy
When `sourceKey` equals `lookupKey`, that name is a requested column, and the left rows carry it, the brought copy SHALL be dropped (the left value is kept, on matched and unmatched rows alike). When `sourceKey` differs from `lookupKey`, a requested column named like `lookupKey` is an ordinary requested column and follows the collision rule.

#### Scenario: Key only
- **WHEN** `sourceKey` = `lookupKey` = `code`, `columns` = `["code"]`, left `[{"code":"A"}]`
- **THEN** the output is `[{"code":"A"}]` with no `right_code`

### Requirement: Lookup runtime and analyze-time column names agree
For a lookup, the column-name set of the analyzed output schema SHALL equal the column-name set of the runtime rows (the requested columns are config-declared, so analyze and runtime see the same names), including prefixed names.

#### Scenario: Parity
- **WHEN** a lookup with collisions is both analyzed and executed over the same inputs
- **THEN** the analyzed output column names equal the runtime row column names
