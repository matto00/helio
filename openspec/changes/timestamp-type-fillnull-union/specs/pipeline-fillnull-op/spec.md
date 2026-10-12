## ADDED Requirements

### Requirement: Analyze flags mean and median on a timestamp-typed column
Analyze SHALL report a `validationError` for an enabled `fillnull` step whose `strategy` is `"mean"`
or `"median"` when any listed column's projected input type is `timestamp`. The message SHALL name
the strategy and every such column, and SHALL point at an alternative (`forwardFill`, `mode`,
`constant`, or casting the column to a number first). The step's projected output schema SHALL be its
input schema unchanged. This check SHALL NOT apply at write time: such a step remains saveable.
Columns absent from the input schema, and columns of any other projected type, SHALL NOT trigger it.
`constant`, `forwardFill` and `mode` on a timestamp column SHALL NOT trigger it. The step's run-time
behaviour is unchanged and runs are not blocked by this error (it sets `canRun: false` in the analyze
response only); the error flags the disagreement, it does not prevent a run from writing a number.

#### Scenario: Mean on a timestamp column is an analyze error
- **WHEN** analyze is called on a pipeline whose `cast` step types `ts` as `timestamp`, followed by
  a fillnull step `{"columns": ["ts"], "strategy": "mean", "value": null}`
- **THEN** the fillnull step carries a `validationError` naming `mean` and `ts`
- **THEN** the analyze response reports the pipeline as not runnable (`step-config-invalid`)

#### Scenario: Median on a timestamp column is an analyze error
- **WHEN** the same pipeline uses `"strategy": "median"`
- **THEN** the fillnull step carries a `validationError` naming `median` and `ts`

#### Scenario: The run still writes a number (flagged, not prevented)
- **WHEN** that fillnull `mean` step is applied at run time to rows whose `ts` values are epoch
  strings with one null
- **THEN** the filled cell is a number (not a timestamp string), which is the disagreement the
  analyze error reports

#### Scenario: Other strategies and numeric columns are unaffected
- **WHEN** analyze is called on a fillnull step using `forwardFill`, `mode` or `constant` on a
  timestamp column, or `mean`/`median` on an `integer`/`float` column
- **THEN** no `validationError` is reported for that step

#### Scenario: A listed column absent from the input schema does not trigger it
- **WHEN** analyze is called on a fillnull `mean` step listing a column that is not in its input schema
- **THEN** this check reports no `validationError` for that column

#### Scenario: The step stays saveable
- **WHEN** a fillnull `mean` step listing a timestamp-typed column is created or updated
- **THEN** the write succeeds (no write-time rejection)
