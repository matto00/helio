## MODIFIED Requirements

### Requirement: Dedupe op removes duplicate rows by key set or whole row
The system SHALL support a `"dedupe"` pipeline step. Config shape: `{"keys": <string[]>, "keep":
<"first"|"last">}`. When `keys` is empty, rows are compared as whole rows (every field/value pair);
when `keys` is non-empty, rows are compared only on the values of those key fields. `keep` SHALL
default to `"first"` when omitted. A supplied `keep` SHALL be matched against `"first"` and `"last"`
case-insensitively, so a value differing only by letter case SHALL be treated as that member. A
supplied `keep` that matches neither member under that comparison SHALL be reported as a validation
failure at analyze time and SHALL fail the run, naming the unsupported value and listing the supported
set; it SHALL NOT be silently treated as `"first"`. The output schema SHALL equal the input schema
(pass-through, no data sampling required on analyze).

This replaces the previous rule that `keep` defaults to `"first"` for "any value other than the literal
`last`". That rule made two distinct inputs indistinguishable: an omitted `keep`, which genuinely means
`"first"`, and a misspelled or differently-cased one, which means the caller asked for something the
system did not provide. Silently resolving the second to `"first"` **inverts which row survives** while
reporting success, which is the failure class this change exists to close.

The engine SHALL preserve the original relative order of the rows that are kept (a stable filter,
identical ordering guarantee to `limit`/`filter`).

#### Scenario: Whole-row distinct
- **WHEN** a dedupe step with `{"keys": [], "keep": "first"}` is applied to rows `[{"a": 1, "b": 2},
  {"a": 1, "b": 2}, {"a": 1, "b": 3}]`
- **THEN** the output is `[{"a": 1, "b": 2}, {"a": 1, "b": 3}]`, in that order

#### Scenario: Key-set dedupe, keep first
- **WHEN** a dedupe step with `{"keys": ["id"], "keep": "first"}` is applied to rows `[{"id": 1,
  "v": "a"}, {"id": 2, "v": "b"}, {"id": 1, "v": "c"}]`
- **THEN** the output is `[{"id": 1, "v": "a"}, {"id": 2, "v": "b"}]`

#### Scenario: Key-set dedupe, keep last
- **WHEN** a dedupe step with `{"keys": ["id"], "keep": "last"}` is applied to rows `[{"id": 1, "v":
  "a"}, {"id": 2, "v": "b"}, {"id": 1, "v": "c"}]`
- **THEN** the output is `[{"id": 2, "v": "b"}, {"id": 1, "v": "c"}]` — original relative order is
  preserved for the rows that survive (the kept "id": 1 row stays at its last-occurrence position,
  not moved to the front)

#### Scenario: Null keys collapse together
- **WHEN** a dedupe step with `{"keys": ["region"], "keep": "first"}` is applied to rows `[{"region":
  null, "v": 1}, {"region": null, "v": 2}]`
- **THEN** the output is `[{"region": null, "v": 1}]` — rows with a null value for the key field are
  treated as sharing that key

#### Scenario: Missing keep defaults to first
- **WHEN** a dedupe step with `{"keys": ["id"]}` (no `keep` field) is applied to rows `[{"id": 1,
  "v": "a"}, {"id": 1, "v": "b"}]`
- **THEN** the output is `[{"id": 1, "v": "a"}]`

#### Scenario: Schema pass-through on analyze
- **WHEN** the analyze endpoint processes a dedupe step
- **THEN** `outputSchema` equals `inputSchema` and `validationError` is `None`

#### Scenario: A differently-cased keep value is honoured
- **WHEN** a dedupe step with `{"keys": ["id"], "keep": "LAST"}` is applied to rows `[{"id": 1,
  "v": "a"}, {"id": 1, "v": "b"}]`
- **THEN** the output is `[{"id": 1, "v": "b"}]`
- **AND** the step is not treated as though `"first"` had been supplied

#### Scenario: An unknown keep value is reported rather than defaulted
- **WHEN** a dedupe step's config has `"keep": "bogus"`
- **THEN** analyze reports a validation error naming `bogus` and listing `first` and `last`
- **AND** running the pipeline fails rather than silently keeping the first row
