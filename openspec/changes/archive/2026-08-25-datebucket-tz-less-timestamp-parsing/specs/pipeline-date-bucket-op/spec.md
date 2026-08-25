## MODIFIED Requirements

### Requirement: DateBucket op floors a timestamp field to the start of a granularity bucket
The execution engine SHALL support the `datebucket` op. The step config SHALL contain `field`
(string: source column name), `granularity` (string: one of `day`, `week`, `month`, `quarter`,
`year`), and an optional `outputColumn` (string; when absent, the op overwrites `field` in place).
For each row, the value at `field` SHALL be parsed as one of: an epoch numeric value; an ISO-8601
instant/offset string (with explicit `Z`/offset); a bare `yyyy-MM-dd` date; or a timezone-less
ISO-8601 local date-time string, in either `T`-separated (`2026-03-14T22:08:39`) or space-separated
(`2026-07-01 12:00:00`) form, each with optional fractional seconds — interpreted as UTC. The
parsed value SHALL then be floored to the start of the `granularity` bucket in UTC, and written to
`outputColumn` (or `field` if `outputColumn` is absent) as a canonical `yyyy-MM-dd` ISO date string.
Week buckets SHALL floor to the Monday (ISO-8601 week start) of the containing week. If the value at
`field` cannot be parsed against any of the above forms, the output field's value for that row
SHALL be `null` (parity with the `cast` op's null-on-failure contract) rather than raising an error
or dropping the row, **except** where the zero-parse-rate execution-failure requirement below
applies (an all-unparseable non-empty input fails the whole step rather than nulling every row). If
`granularity` is not one of the five supported values, step execution SHALL fail with a descriptive
error identifying the invalid value and the supported set.

#### Scenario: Floor to day
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  containing `{"ts": "2026-03-17T14:32:00Z"}`
- **THEN** the output row contains `{"ts": "2026-03-17"}`

#### Scenario: Floor to week floors to the Monday of that ISO week
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "week"}` is applied to a row
  containing `{"ts": "2026-03-19"}` (a Thursday)
- **THEN** the output row's `ts` is `"2026-03-16"` (the Monday of that week)

#### Scenario: Floor to month
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month"}` is applied to a row
  containing `{"ts": "2026-03-17"}`
- **THEN** the output row's `ts` is `"2026-03-01"`

#### Scenario: Floor to quarter
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "quarter"}` is applied to a row
  containing `{"ts": "2026-08-05"}`
- **THEN** the output row's `ts` is `"2026-07-01"` (start of Q3)

#### Scenario: Floor to year
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "year"}` is applied to a row
  containing `{"ts": "2026-08-05"}`
- **THEN** the output row's `ts` is `"2026-01-01"`

#### Scenario: Epoch seconds input is parsed
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to a row
  containing `{"ts": "1771286400"}` (an epoch-seconds value)
- **THEN** the output row's `ts` is a valid ISO date string derived from that instant

#### Scenario: outputColumn writes to a new field, preserving the source field
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month", "outputColumn":
  "ts_month"}` is applied to a row containing `{"ts": "2026-03-17T00:00:00Z", "name": "foo"}`
- **THEN** the output row contains `{"ts": "2026-03-17T00:00:00Z", "ts_month": "2026-03-01", "name":
  "foo"}` — the original `ts` value is unchanged

#### Scenario: Timezone-less T-separated timestamp is parsed as UTC
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month"}` is applied to a row
  containing `{"ts": "2026-03-14T22:08:39"}`
- **THEN** the output row's `ts` is `"2026-03-01"` (not `null`)

#### Scenario: Timezone-less space-separated timestamp is parsed as UTC
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month"}` is applied to a row
  containing `{"ts": "2026-07-01 12:00:00"}`
- **THEN** the output row's `ts` is `"2026-07-01"` (not `null`)

#### Scenario: Unparseable value yields null when at least one other row parses
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  `[{"ts": "2026-03-17T00:00:00Z"}, {"ts": "not-a-date"}]`
- **THEN** the output rows are `[{"ts": "2026-03-17"}, {"ts": null}]` — the unparseable row's
  output is `null`, the parseable row's output is unaffected (this is a *partially*-parseable
  input; see the zero-parse-rate execution-failure requirement below for the all-unparseable case)

#### Scenario: Unsupported granularity fails at execute time
- **WHEN** a datebucket step is configured with `{"field": "ts", "granularity": "fortnight"}` and
  the pipeline is executed
- **THEN** execution fails with a descriptive error naming `fortnight` as unsupported and listing
  the valid granularities

## ADDED Requirements

### Requirement: DateBucket op fails loudly when zero rows parse out of a non-empty input
The `datebucket` op SHALL fail step execution (the same execution-failure mechanism already used
when `granularity` is unsupported — the step fails before any row is returned, it does not surface
an analyze-time `validationError`) when the input contains at least one row whose `field` value is
present (non-null, non-blank) and none of those rows' `field` values can be parsed under any
accepted form — rather than returning a result where every row's bucketed output is `null`. This
guard SHALL NOT fire when the input has no rows, or when every row's `field` value is
absent/null/blank (nothing to bucket is not an error). This guard SHALL NOT fire when at least one
row successfully parses, even if other rows in the same input do not (the per-row null-on-partial-
failure contract above is unaffected).

#### Scenario: All-unparseable non-empty input fails loudly
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  `[{"ts": "not-a-date"}, {"ts": "also-not-a-date"}]`
- **THEN** step execution fails with a descriptive error rather than returning
  `[{"ts": null}, {"ts": null}]`

#### Scenario: Empty input does not trigger the guard
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to zero rows
- **THEN** step execution succeeds, returning zero rows

#### Scenario: All-field-absent input does not trigger the guard
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  `[{"other": "x"}, {"other": "y"}]` (the `ts` field is absent from every row)
- **THEN** step execution succeeds, returning rows with `{"ts": null}` for each

#### Scenario: Partially-parseable input does not trigger the guard
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  `[{"ts": "2026-03-17T00:00:00Z"}, {"ts": "not-a-date"}]`
- **THEN** step execution succeeds, returning `[{"ts": "2026-03-17"}, {"ts": null}]`
