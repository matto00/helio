## Purpose

One definition of which values the pipeline engine reads as a point in time, so that the datebucket step, the cast step's timestamp/date targets, and compute date/time functions never disagree about whether a value is a timestamp or which instant it denotes.

## ADDED Requirements

### Requirement: A single shared parser defines the accepted timestamp shapes
The pipeline engine SHALL read a value as an instant (UTC) only through one shared parser that accepts exactly:
- a whole-number epoch value within the signed 64-bit range, given either as a number or as a numeric string. The
  string may be written with a decimal point or exponent when its value is whole (e.g. `"1771286400.0"`,
  `"1.7712864E9"`). It is read as epoch milliseconds when its magnitude exceeds 9999999999, and as epoch seconds
  otherwise. Fractional, non-finite and out-of-range numbers are not timestamps;
- an ISO-8601 instant or offset date-time string (`Z` or an explicit offset), converted to UTC;
- a timezone-less local date-time string, `T`-separated or space-separated, with optional seconds and optional
  0–9-digit fractional seconds, read as UTC;
- a bare `yyyy-MM-dd` date, read as midnight UTC.

Surrounding whitespace SHALL be ignored. `null`, blank, and every other value SHALL be "not a timestamp".
- The datebucket step SHALL parse its input field only through this parser.
- The compute date/time functions SHALL parse their timestamp arguments only through this parser.
- The window step's day-based rolling frames (`frameUnit: days`) SHALL read their `orderBy` key through the datebucket step's date parsing, and are therefore bound by this same parser (a JSON-number epoch orders and frames like it buckets).
- The cast step's `timestamp` and `date` targets SHALL keep every value this parser accepts. Per HEL-1436 D3, they
  also keep values accepted by source schema inference's timestamp reader.

#### Scenario: datebucket and compute agree on every accepted shape
- **WHEN** each of `"2026-07-01T12:00:00Z"`, `"2026-07-01T14:00:00+02:00"`, `"2026-07-01T12:00:00"`, `"2026-07-01 12:00:00.123456"`, `"2026-07-01 12:00"`, `"2026-07-01"`, `"1782907200"`, the JSON number `1782907200`, and `1782907200000` is bucketed to `day` by a datebucket step, and truncated with `date_trunc("day", ...)` in a compute step
- **THEN** each value buckets to `"2026-07-01"` in datebucket, and to `"2026-07-01T00:00:00Z"` in compute
- **AND** a cast step to `timestamp` keeps every one of those values non-null

#### Scenario: rejected shapes are rejected everywhere
- **WHEN** `"not a date"`, `""`, `"2026-13-01"` or `"2026-07-01T25:00:00Z"` is given to a datebucket step and to `date_trunc("day", ...)`
- **THEN** both produce `null` for that row

#### Scenario: whole-number epochs written with a decimal point or exponent are parsed
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` runs over rows whose `ts` is `"1771286400.0"`, `"1.7712864E9"` and `"1771286400.5"`
- **THEN** the first two bucket to `"2026-02-17"` and the third is `null`

#### Scenario: a JSON-number epoch is parsed by datebucket
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` runs over a row whose `ts` is the JSON number `1771286400`
- **THEN** the output `ts` is `"2026-02-17"` (it was previously `null`, contrary to the datebucket spec's "epoch numeric value" clause)
