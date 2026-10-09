## ADDED Requirements

### Requirement: CSV blank cells are null when a pipeline reads a CSV source
When a pipeline run, dry run or step preview reads a CSV source (as its root or as a secondary source of a join,
union or lookup), every cell that is empty, quoted-empty, or contains only whitespace SHALL be null. A row with fewer
cells than the header SHALL have null for each missing trailing cell. A line that is empty or whitespace-only SHALL
NOT produce a row. A non-blank cell SHALL be passed through unchanged, including any leading or trailing spaces.

#### Scenario: Empty and whitespace-only cells become null
- **WHEN** a CSV source `id,name\n1,\n2,"  "\n3,""\n4, Bo ` is read by a pipeline run
- **THEN** `name` is null for ids 1, 2 and 3, and is the string `" Bo "` for id 4

#### Scenario: Short rows pad with null
- **WHEN** a CSV source `a,b,c\n1` is read
- **THEN** the single row is `{a: "1", b: null, c: null}`

#### Scenario: Blank lines are skipped
- **WHEN** a CSV source `a\n1\n\n   \n2` is read
- **THEN** exactly two rows are produced

### Requirement: CSV schema inference and source preview are unchanged
Schema inference SHALL continue to declare every CSV column `string`, and a column whose sampled cells are all blank
SHALL infer exactly as before (`string`). The CSV source preview SHALL continue to return blank cells as empty
strings. Sources that are not CSV (SQL, REST, dataset, static JSON) SHALL NOT be affected.

#### Scenario: All-blank column infers as before
- **WHEN** a CSV whose `notes` column is blank in every row is uploaded
- **THEN** `notes` is inferred as a `string` field, exactly as before this change

### Requirement: Aggregate counts and fillnull treat CSV blanks as null
For rows read from a CSV source, aggregate `count` and `count_distinct` SHALL NOT count blank cells, and `fillnull`
SHALL fill blank cells under every strategy.

#### Scenario: count and count_distinct exclude blanks
- **WHEN** a CSV `id,t\n1,A\n2,\n3,B\n4,A` is aggregated with `count(t)` and `count_distinct(t)` and no groupBy
- **THEN** `count` is 3 and `count_distinct` is 2

#### Scenario: fillnull fills blanks
- **WHEN** a `fillnull` step `{"columns":["t"],"strategy":"constant","value":"none"}` runs on a CSV with a blank `t`
- **THEN** that row's `t` is `"none"`

### Requirement: Downstream steps apply null semantics to CSV blanks
For rows read from a CSV source, a blank cell SHALL behave as null in every step: it SHALL sort last in both
directions; group, pivot-index, dedupe and join keys SHALL use null; a pivot row whose pivot column is blank SHALL
contribute to no value column; `assert` `notNull` SHALL fail on it; `cast` to any type SHALL yield null; a compute
expression referencing it SHALL yield null; `is null` SHALL match it. The pipeline Output schema SHALL ignore blank
cells when inferring a column type, so a date-like column with blanks infers as a timestamp.

#### Scenario: Blank sorts last descending
- **WHEN** a sort `desc` on a CSV numeric-string column `5`, blank, `9` runs
- **THEN** the order is `9`, `5`, blank

#### Scenario: is null matches a blank
- **WHEN** a filter `is null` on a CSV column with a blank runs
- **THEN** the blank row is kept

#### Scenario: Date-like column with blanks infers timestamp
- **WHEN** a pipeline Output materializes a CSV column `2026-01-01`, blank, `2026-01-03`
- **THEN** the Output schema types that column as a timestamp

### Requirement: AI and text steps treat a null input cell as empty text
`analyzewithai`, `generatetext` and `convertformat` SHALL treat an input field that is present with a null value
exactly as an empty string. An absent input field SHALL still fail the step with `field-missing`.

#### Scenario: generatetext on a blank CSV cell does not fail field-missing
- **WHEN** a `generatetext` step runs over a CSV row whose input field is blank
- **THEN** the step does not fail with `field-missing`; the content sent is the empty string

### Requirement: Cross-filtering on a blank category selects blank rows
Selecting a chart category whose underlying value is null (blank) SHALL cross-filter sibling panels to their rows
whose dimension is null or the empty string, on both the client-filtered and the server-filtered path. A server Output
read with an `eq` op whose value is the empty string SHALL match cells that are null or the empty string.

#### Scenario: Blank category cross-filters siblings to blank rows
- **WHEN** an aggregated chart grouped by `team` over CSV rows with a blank `team` and the user filters the dashboard
  by the blank category
- **THEN** a sibling table over the same rows shows exactly the rows whose `team` is blank

#### Scenario: Server eq "" matches null
- **WHEN** an Output's rows are read with an `eq` op of value `""` on a column holding null in two rows
- **THEN** those two rows are returned

### Requirement: The metric panel's loaded-row count excludes nulls
The metric panel's count computed over loaded rows SHALL exclude null cells, matching the server-computed headline.

#### Scenario: Client count matches server count
- **WHEN** a metric panel with `count` aggregation loads rows where the value column is null in one of three rows
- **THEN** the loaded-row value is 2
