## Purpose
Defines Output-scoped per-column display formatting for table panels — the spec shape on
`TableOutputConfig`, the formatter semantics for number, date, currency and text, the never-throw
fallback, the guarantee that sorting reads raw values rather than formatted text, and what
formatting means for a value that was stringified before the table received it.

## ADDED Requirements

### Requirement: Format specs persist per column on the Output
Per-column format specs SHALL be stored as `columnFormats` on the Output's `TableOutputConfig`, as a
flat top-level sibling of the existing column settings rather than nested inside any other key or a
shared container. They SHALL NOT be stored on the panel placement record. Reading a `columnFormats`
that is absent or malformed SHALL yield unformatted rendering rather than an error, and an entry
naming a column that is not present SHALL be ignored.

Because the state lives on the Output, formats SHALL apply to every panel bound to that Output on
load. Panels do not converge live.

#### Scenario: A formatted column reopens formatted
- **WHEN** a column's format has been set and the Output config is re-read after a reload
- **THEN** the column renders with that format still applied

#### Scenario: Absent format state renders unformatted
- **WHEN** an Output config carries no `columnFormats`
- **THEN** every column renders exactly as it did before formatting existed

#### Scenario: A malformed or unknown-column spec is ignored
- **WHEN** a stored spec is not an object, names an unrecognised format type, or names a column
  absent from the data
- **THEN** the affected column renders unformatted rather than throwing

### Requirement: Sorting reads raw values, never formatted text
Sorting SHALL compare the underlying cell values, not the text produced by formatting. A column
whose formatted text would order differently from its raw values SHALL still order by the raw
values. This separation SHALL be protected by a test that fails if the comparator is ever pointed at
the formatted output.

#### Scenario: A currency column sorts numerically, not lexically
- **WHEN** a column formatted as currency contains values whose formatted text sorts differently
  from their numeric order, and that column is sorted ascending
- **THEN** the rows order by the numeric values

#### Scenario: Formatting a column does not change its sort order
- **WHEN** a sort is active and a format is then applied to the sorted column
- **THEN** the row order is unchanged

### Requirement: Formatting never throws and falls back to the raw value
A value that cannot be interpreted as the column's format type SHALL render as its own raw string.
Null and undefined SHALL continue to render as the existing empty-value indicator. Formatting SHALL
NOT change which rows are rendered.

#### Scenario: An unparseable value renders unchanged
- **WHEN** a column formatted as a number contains a value that is not numeric
- **THEN** that cell renders its raw text and no error is raised

#### Scenario: Empty values keep the existing indicator
- **WHEN** a formatted column contains null or undefined values
- **THEN** those cells render the same empty-value indicator as an unformatted column

#### Scenario: Formatting does not change the row set
- **WHEN** a format is applied to any column
- **THEN** the same rows render, in the same order, as before it was applied

### Requirement: Formatting output is deterministic under test
Formatting SHALL be locale- and timezone-aware at runtime, and its verification SHALL fix the locale
and timezone explicitly rather than inheriting the execution environment's. A verification that
inherits the environment can pass in one region and fail in another for the same code, which makes
it evidence of the environment rather than of the behaviour.

#### Scenario: Formatting verification does not depend on the host environment
- **WHEN** the formatting verification runs under a different host locale or timezone
- **THEN** its result is unchanged

#### Scenario: A date renders in the fixed timezone rather than the host's
- **WHEN** a date-formatted column contains an instant near a day boundary
- **THEN** the rendered calendar day is the one implied by the fixed timezone

### Requirement: A value stringified before the table receives it formats only if it survived
Where the row set reaches the table already converted to strings, a value SHALL be formatted if it
remains interpretable as the column's type, and SHALL otherwise fall back under the never-throw
rule. No special case SHALL be added for values whose type was destroyed upstream; the fallback is
the correct and honest outcome, and a special case would imply a repair this capability does not
make.

#### Scenario: A numeric value that survived stringification still formats
- **WHEN** a number-formatted column's values reached the table as numeric strings
- **THEN** they render formatted

#### Scenario: A value whose type was destroyed upstream renders unchanged
- **WHEN** a formatted column's values reached the table as a placeholder produced by stringifying a
  non-primitive
- **THEN** those cells render that placeholder unchanged, with no error

### Requirement: Filtering matches the text the user can see, sorting orders the underlying value
A filter term SHALL be matched against a column's RENDERED text, resolved through the same
per-column formatter the cell renders with, so that every match is visible in the cell that
matched and no cell matches text appearing nowhere on screen. Sorting SHALL continue to read the
RAW underlying value, so that ordering is numeric rather than lexical.

These two SHALL NOT be unified onto a single source. Matching on raw values would let a cell match
a term absent from its visible text; ordering on rendered text would reintroduce lexical ordering
of numbers. A column with no format configured SHALL behave exactly as before, so that existing
filter behaviour is unchanged.

#### Scenario: A formatted cell matches the text it displays
- **WHEN** a currency-formatted column renders a cell as a grouped, symbol-prefixed amount
- **AND** the filter term is a substring of that displayed text
- **THEN** the row matches

#### Scenario: A formatted cell does not match text it never displays
- **WHEN** a currency-formatted column's underlying value is an ungrouped bare number
- **AND** the filter term is a substring of only that underlying value
- **THEN** the row does NOT match

#### Scenario: Sorting a formatted numeric column stays numeric
- **WHEN** a number-formatted column containing values whose rendered text would sort lexically in a
  different order is sorted
- **THEN** the rows order by the underlying numeric value

#### Scenario: An unformatted column filters exactly as before
- **WHEN** no format is configured for a column
- **THEN** filtering that column matches precisely the rows it matched before this capability existed
