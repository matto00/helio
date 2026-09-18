## Purpose
Defines the append-only `{occurred_at, delta, value}` event-row contract for a counter-configured `form` field, and
the guarantee that a running total is derivable by pipeline rather than stored or mutated.

## ADDED Requirements

### Requirement: A counter submission appends an event row, never mutates a stored total

A `form` field configured with the `counter` control SHALL, on submit, cause exactly one new `dataset_rows` row to
be INSERTed. No existing row SHALL be read back and UPDATEd, and no separate "current total" cell or row SHALL be
written or mutated in place, regardless of how many prior counter submissions exist for the same source.

#### Scenario: A sequence of increments and decrements produces one row each
- **WHEN** a counter field receives five submissions (deltas `+1, +1, -1, +1, -1`)
- **THEN** exactly five `dataset_rows` rows exist for that source, one per submission, and none of the earlier
  four rows' `data` payload has changed

#### Scenario: Rapid/concurrent submissions are never coalesced
- **WHEN** two counter submissions for the same source are sent concurrently (e.g. a double-click or keyboard
  repeat)
- **THEN** both are persisted as two distinct rows with distinct `seq` values; neither is dropped or merged

### Requirement: A counter row's `occurred_at` is server-assigned and orderable at millisecond collision

The server SHALL assign `occurred_at` at write time; a client-supplied `occurred_at` value, if present in the
request, SHALL be ignored. Two rows whose `occurred_at` values collide at millisecond precision SHALL remain
distinguishable and correctly orderable via `dataset_rows.seq`, which is assigned monotonically per source under
the same append lock as the row insert.

#### Scenario: Two same-millisecond events remain distinguishable and ordered
- **WHEN** two counter submissions for the same source are persisted with `occurred_at` values equal at millisecond
  precision
- **THEN** their `seq` values differ and sorting by `(occurred_at, seq)` reproduces submission order

### Requirement: A counter field can only be bound to a dataset that structurally supports the row shape

`FormSchemaConsistency.check` SHALL reject a `form` panel config containing a `counter`-control field when the
bound dataset's declared schema does not also declare a `TimestampType` field literally named `occurred_at` and a
numeric, non-required field literally named `value`. This check SHALL run wherever `FormSchemaConsistency.check`
already runs (both the write API and the author-time client mirror) — never only at submit time, so an
inconsistent binding is caught before any row is ever appended.

#### Scenario: Binding a counter to a dataset missing `occurred_at` is rejected
- **WHEN** a form config's `counter` field is checked against a dataset declaration with no `occurred_at` field
- **THEN** `FormSchemaConsistency.check` returns `Left` naming the missing field, before any submit is possible

#### Scenario: Binding a counter to a dataset with a required `value` is rejected
- **WHEN** a form config's `counter` field is checked against a dataset declaration where `value` is declared
  `required: true`
- **THEN** `FormSchemaConsistency.check` returns `Left` — a nullable snapshot column can never be required

### Requirement: The running total is derivable from the delta sequence by pipeline, never read back as stored state

A `value` cell on a counter row MAY be recorded as a non-authoritative convenience snapshot, but no code path SHALL
treat a stored `value` cell as the authoritative running total. The running total for a counter dataset SHALL be
computable by an `aggregate`/`sum` pipeline step over the `delta` column, independent of whatever `value` cells (if
any) are stored.

#### Scenario: Running total matches an independent sum of deltas
- **WHEN** a counter dataset has N rows with delta values `d1..dN`
- **THEN** an `aggregate` pipeline step summing `delta` over those rows yields `d1+...+dN`, matching the true
  running total, without reading any `value` cell

#### Scenario: A time-series Output renders the append sequence
- **WHEN** a pipeline Output is built over a counter dataset ordered by `(occurred_at, seq)`
- **THEN** the Output reflects one point per submitted event, in submission order
