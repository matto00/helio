# timestamp-value-parsing Specification

## Purpose
One definition of which values the pipeline engine reads as a point in time, so that the datebucket step, the cast step's timestamp/date targets, and compute date/time functions never disagree about whether a value is a timestamp or which instant it denotes.

## Requirements

### Requirement: A single shared parser defines the accepted timestamp shapes
The pipeline engine SHALL read a value as an instant (UTC) only through one shared parser that accepts exactly:
- a whole-number epoch value within the signed 64-bit range, given either as a number or as a numeric string. The
  string may be written with a decimal point or exponent when its value is whole (e.g. `"1771286400.0"`,
  `"1.7712864E9"`). It is read as epoch milliseconds when its magnitude exceeds 9999999999, and as epoch seconds
  otherwise. Fractional, non-finite and out-of-range numbers are not timestamps. An epoch whose instant falls
  outside `0001-01-01T00:00:00Z` .. `9999-12-31T23:59:59.999999999Z` is not a timestamp;
- an ISO-8601 instant or offset date-time string (`Z` or an explicit offset), converted to UTC;
- a date-time, `T`-separated or space-separated, with optional seconds and optional 1–9-digit fractional seconds,
  followed by a numeric offset written `+HH`, `+HHMM`, `+HH:MM` or `+HH:MM:SS` (or `-`), each part two digits,
  hours at most 18, minutes and seconds at most 59, and the total offset at most 18:00, converted to UTC (the
  Postgres `timestamptz` text form, e.g. `2026-07-01 12:00:00+00`). `Z` is accepted only with a `T` separator;
- any accepted offset date-time (`Z` or a numeric offset as above) followed by a bracketed id of one or more
  letters, digits, `_`, `+`, `-`, `/` or `:` (e.g. `2026-07-01T12:00:00+02:00[Europe/Paris]`), read at its written
  offset. The id is not checked against a time-zone database. A bracketed id with no offset is not a timestamp;
- a timezone-less local date-time string, `T`-separated or space-separated, with optional seconds and optional
  1–9-digit fractional seconds, read as UTC;
- a bare `yyyy-MM-dd` date, read as midnight UTC;
- a `MM/dd/yyyy` date (two-digit month and day), read as midnight UTC. An impossible calendar date
  (e.g. `02/30/2026`) is not a timestamp.

No shape SHALL be read by clamping, rolling or folding: an impossible calendar date (e.g. `2026-02-29`), hour `24`,
or a leap second (`:60`) in ANY accepted shape is not a timestamp. A WRITTEN year (the date's own digits, before any offset is applied) outside `0001`..`9999` (year `0000`, or an
extended `+YYYYY`/`-YYYY` year) in any non-epoch shape, including the year of a `MM/dd/yyyy` date, is not a timestamp. A fractional-seconds part SHALL have
1-9 digits and SHALL follow seconds: a bare `.` (e.g. `12:00:00.Z`) or a fraction after minutes (e.g. `12:00.5`) is not
a timestamp.
Surrounding whitespace SHALL be ignored. `null`, blank, and every other value SHALL be "not a timestamp".
Source schema inference's timestamp reader is NOT this parser and is unchanged by it.
- The datebucket step SHALL parse its input field only through this parser.
- The compute date/time functions SHALL parse their timestamp arguments only through this parser.
- The window step's day-based rolling frames (`frameUnit: days`) SHALL read their `orderBy` key through the datebucket step's date parsing, and are therefore bound by this same parser (a JSON-number epoch orders and frames like it buckets).
- The cast step's `timestamp` and `date` targets SHALL keep exactly the values this parser accepts, so every value
  a cast keeps is readable by the datebucket step, the compute date/time functions and the window day frames.

#### Scenario: datebucket and compute agree on every accepted shape
- **WHEN** each of `"2026-07-01T12:00:00Z"`, `"2026-07-01T14:00:00+02:00"`, `"2026-07-01T12:00:00"`, `"2026-07-01 12:00:00.123456"`, `"2026-07-01 12:00"`, `"2026-07-01"`, `"1782907200"`, the JSON number `1782907200`, `1782907200000`, `"2026-07-01 12:00:00+00"`, `"2026-07-01 17:30:00+0530"`, `"2026-07-01T14:00:00+02:00[Europe/Paris]"` and `"07/01/2026"` is bucketed to `day` by a datebucket step, and truncated with `date_trunc("day", ...)` in a compute step
- **THEN** each value buckets to `"2026-07-01"` in datebucket, and to `"2026-07-01T00:00:00Z"` in compute
- **AND** a cast step to `timestamp` keeps every one of those values non-null

#### Scenario: Postgres timestamptz text is read at its offset
- **WHEN** `seconds_between("2026-07-01 12:00:00+00", "2026-07-01 12:00:00-0130")` is evaluated in a compute step
- **THEN** the result is `-5400` (end − start: 12:00Z − 13:30Z)

#### Scenario: a bracketed id never overrides the written offset
- **WHEN** `date_trunc("hour", ...)` is evaluated in a compute step over `"2026-07-01T17:00:00+05:00[Europe/Paris]"` and `"2026-07-01T14:00:00+02:00[Bogus/Zone]"`
- **THEN** both yield `"2026-07-01T12:00:00Z"`

#### Scenario: out-of-range offsets are rejected
- **WHEN** `"2026-07-01 12:00:00+18:30"`, `"2026-07-01T12:00:00+18:00:01"`, `"2026-07-01 12:00:00+053015"`, `"2026-07-01 12:00:00+0530:15"`, `"2026-07-01 12:00:00+5"` or `"2026-07-01 12:00:00+05:3"` is given to a datebucket step
- **THEN** it produces `null` for that row

#### Scenario: rejected shapes are rejected everywhere
- **WHEN** `"not a date"`, `""`, `"2026-13-01"`, `"2026-07-01T25:00:00Z"`, `"02/30/2026"`, `"2026-07-01 12:00:00Z"` or `"2026-07-01T12:00:00[Europe/Paris]"` is given to a datebucket step and to `date_trunc("day", ...)`
- **THEN** both produce `null` for that row

#### Scenario: whole-number epochs written with a decimal point or exponent are parsed
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` runs over rows whose `ts` is `"1771286400.0"`, `"1.7712864E9"` and `"1771286400.5"`
- **THEN** the first two bucket to `"2026-02-17"` and the third is `null`

#### Scenario: a JSON-number epoch is parsed by datebucket
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` runs over a row whose `ts` is the JSON number `1771286400`
- **THEN** the output `ts` is `"2026-02-17"` (it was previously `null`, contrary to the datebucket spec's "epoch numeric value" clause)

#### Scenario: epochs outside years 0001-9999 are not timestamps
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` runs over rows whose `ts` is `"-9223372036854775808"`, `"253402300800000"`, `"253402300799999"`, `"-62135596800000"`, `"-62135596800001"` and `"-62135596800"`
- **THEN** the first two are `null`, the third buckets to `"9999-12-31"`, the fourth to `"0001-01-01"`, the fifth is `null`, and the sixth (read as milliseconds) buckets to `"1968-01-12"`

#### Scenario: fabricated, out-of-range-year and malformed-fraction values are not timestamps
- **WHEN** each of `"2026-07-01T12:00:00.Z"`, `"2026-07-01T23:59:60Z"`, `"+12026-07-01T12:00:00Z"`, `"0000-07-01T12:00:00Z"`, `"0000-07-01 12:00"`, `"0000-07-01"`, `"07/01/0000"`, `"2026-07-01 12:00:00."`, `"2026-02-29 12:00"`, `"2026-07-01 24:00"` and `"2026-07-01 12:00.5"`, `"2026-07-01T12:00.5"`, `"2026-07-01T24:00"` and `"2026-07-01T12:00:60.5Z"` is given to a datebucket step, to `date_trunc("day", ...)` and to a cast step targeting `timestamp`
- **AND** the same value is parsed by the chart's x parser
- **THEN** every one yields `null` (no instant) on every one of those readers
- **AND** `"0001-01-01T00:30:00+01:00"` and `"9999-12-31T23:00:00-05:00"` (written years in range) remain timestamps on every reader
