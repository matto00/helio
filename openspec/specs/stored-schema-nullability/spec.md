# stored-schema-nullability Specification

## Purpose
Defines the nullability that CSV-source and Output schemas report, so a column that can hold null is never
advertised as `nullable: false`.

## Requirements

### Requirement: CSV source schemas report nullability from every data row
When a CSV source is created (upload or URL) or refreshed, its stored schema SHALL record, per column, `nullable:
true` if any data row's cell for that column is blank (empty, quoted-empty, whitespace-only or missing), and
`nullable: false` otherwise. A blank or whitespace-only line is not a data row (it produces no row when loaded) and
SHALL NOT mark any column nullable. Every data row SHALL be considered, not only a leading sample. The source's
`inferredSchema` in the create response and in data-source list reads SHALL carry that value; after a refresh, the
next list read SHALL carry the refreshed value. Column types SHALL be unchanged.

#### Scenario: All-blank column is nullable
- **WHEN** a CSV whose `notes` column is blank in every row is uploaded
- **THEN** the source's `inferredSchema` reports `notes` as `string` with `nullable: true`, on create and on a later
  list read

#### Scenario: Refresh records nullability
- **WHEN** a CSV source whose `score` column had no blanks is refreshed with a file in which `score` has a blank
- **THEN** the next data-source list read reports `score` with `nullable: true`

#### Scenario: Blank beyond the first hundred rows
- **WHEN** a CSV with 150 data rows whose `score` is blank only in row 150 is uploaded
- **THEN** `score` reports `nullable: true`

#### Scenario: Fully populated column is not nullable
- **WHEN** a CSV file ending in a newline, whose `id` column is non-blank in every row, is uploaded
- **THEN** `id` reports `nullable: false`

### Requirement: Output schemas report nullability from the materialized rows
When a pipeline run (or run backfill) writes an Output's schema, each column SHALL record `nullable: true` if any
materialized row holds null for it or lacks it, and `nullable: false` otherwise. Panel capability columns and
assistant workspace-context columns for that Output SHALL report the stored value.

#### Scenario: Output column with a null is nullable
- **WHEN** a pipeline run materializes rows `{t:"a"}`, `{t:null}` for an Output
- **THEN** that Output's panel capability column `t` reports `nullable: true`

### Requirement: Legacy stored schemas read conservatively without a migration
A stored CSV-source or Output schema field with no recorded nullability SHALL read as `nullable: true`. Stored
schemas of every other source kind SHALL report exactly the nullability they report before this change. No stored
row SHALL be rewritten by a migration; a legacy CSV source or Output gains recorded nullability on its next refresh
or run.

#### Scenario: Legacy CSV source
- **WHEN** a CSV source stored before this change (schema fields without nullability) is listed
- **THEN** each of its columns reports `nullable: true`

#### Scenario: Other kinds unchanged
- **WHEN** an image source is listed
- **THEN** its `width`, `height` and `mimeType` fields report `nullable: false`, as before
