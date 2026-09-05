## MODIFIED Requirements

### Requirement: Sort op executes multi-column stable sort
The backend `InProcessPipelineEngine` SHALL handle `op = "sort"` by sorting rows according to the
`sortBy` array in the config. Each element of `sortBy` is an object with `field` (string) and
`direction` ("asc" or "desc"). Rows are sorted stably; nulls sort last for both directions.
An empty `sortBy` array SHALL be treated as a no-op (all rows returned in original order).

The ordering relation used for a single sort key SHALL be a **strict weak ordering** over every value the
column can hold — irreflexive, antisymmetric, and transitive, with transitive equivalence — for every column
shape, including columns whose values are entirely numeric, entirely non-numeric, a mixture of both, or
contain nulls. It is a strict weak ordering rather than a strict total order because distinct values may
compare equivalent (see the cross-type equivalence rule below); implementations and tests SHALL NOT assume
trichotomy. The relation SHALL NOT depend on the order in which rows are presented.

That relation is defined as three tiers, ordered outermost-first:

1. Values that convert to a **finite** number (including numeric-looking strings such as `"9"`) — compared
   numerically.
2. Every other non-null value — compared as strings, lexicographically. This tier explicitly **includes**
   values that convert to `NaN` or to positive or negative infinity (for example the strings `"NaN"`,
   `"Infinity"`, and a raw `Double.NaN`), because a cell that only *looks* numeric but coerces to
   `NaN`/`Infinity` is junk data, not a magnitude the user meant to rank — ranking it among real numbers
   (`NaN` sorting above every actual value) would be a nonsensical result, not a correctness requirement.
3. Nulls (and absent fields).

Every tier-1 value SHALL sort before every tier-2 value, and every tier-2 value SHALL sort before every
null, when direction is `asc`. When direction is `desc`, the ordering **within** tiers 1 and 2 is reversed
and the relative order of tiers 1 and 2 is reversed, but nulls SHALL remain last, preserving the existing
null convention in both directions.

A numeric value and a numeric-looking string of the same magnitude (for example `9` and `"9"`) SHALL compare
**equivalent**, being both tier 1 with equal numeric value. Because the sort is stable, the relative order of
equivalent values in the output is their relative order in the input. Consequently the output SHALL be
determined uniquely **up to the order of equivalent values**: two different input permutations of the same
multiset SHALL produce output sequences with the same sequence of sort-key equivalence classes, though
values within an equivalence class may appear in different order.

#### Scenario: Single-column ascending sort
- **WHEN** a sort step with `{"sortBy": [{"field": "age", "direction": "asc"}]}` is applied to rows
- **THEN** rows are returned ordered by the `age` field ascending, with nulls last

#### Scenario: Single-column descending sort
- **WHEN** a sort step with `{"sortBy": [{"field": "name", "direction": "desc"}]}` is applied to rows
- **THEN** rows are returned ordered by the `name` field descending, with nulls last

#### Scenario: Multi-column sort (primary and secondary key)
- **WHEN** a sort step with `{"sortBy": [{"field": "country", "direction": "asc"}, {"field": "score", "direction": "desc"}]}` is applied
- **THEN** rows are first sorted by `country` ascending, then by `score` descending within each country group

#### Scenario: Empty sortBy is a no-op
- **WHEN** a sort step with `{"sortBy": []}` is applied
- **THEN** all rows are returned in their original order

#### Scenario: Null values sort last
- **WHEN** some rows have null for the sort field and a sort step is applied
- **THEN** null rows appear after all non-null rows, regardless of direction

#### Scenario: Numeric-looking strings compare numerically
- **WHEN** a column holds only the values `"9"`, `"10"` and `"100"` as strings and is sorted ascending
- **THEN** the rows are returned in the order `"9"`, `"10"`, `"100"` — numerically, not lexicographically

#### Scenario: Partly-numeric column keeps its numbers in numeric order
- **WHEN** a column holds `10`, `9` and `"n/a"` and is sorted ascending
- **THEN** the rows are returned in the order `9`, `10`, `"n/a"` — the numeric values retain numeric order
  rather than degrading to lexicographic order because one value does not convert

#### Scenario: Partly-numeric column reverses tiers when descending
- **WHEN** a column holds `10`, `9`, `"n/a"` and a null, and is sorted descending
- **THEN** the rows are returned in the order `"n/a"`, `10`, `9`, null — the non-coercible tier leads, the
  numeric tier follows in descending order, and the null remains last

#### Scenario: NaN and infinity sort as non-coercible, not as numbers
- **WHEN** a column holds `5`, `"NaN"`, `"Infinity"` and `"n/a"` and is sorted ascending
- **THEN** `5` sorts first as the only tier-1 value, and `"Infinity"`, `"NaN"` and `"n/a"` follow in
  lexicographic order as tier-2 values

#### Scenario: Ordering does not depend on input order
- **WHEN** the same multiset of mixed numeric, non-coercible and null values is sorted from two different
  input permutations with the same sort key
- **THEN** both runs return the same sequence of sort-key equivalence classes; values that compare
  equivalent (such as `9` and `"9"`) may appear in either order within their class
