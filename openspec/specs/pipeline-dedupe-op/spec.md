# pipeline-dedupe-op Specification

## Purpose
The `dedupe` pipeline step removes duplicate rows by whole-row or key-set equality, honoring
first/last-occurrence semantics with stable output order and identity schema passthrough.
## Requirements
### Requirement: Dedupe op removes duplicate rows by key set or whole row
The system SHALL support a `"dedupe"` pipeline step. Config shape: `{"keys": <string[]>, "keep":
<"first"|"last">}`. When `keys` is empty, rows are compared as whole rows (every field/value pair);
when `keys` is non-empty, rows are compared only on the values of those key fields. `keep` SHALL
default to `"first"` when omitted or any value other than the literal `"last"`. The output schema
SHALL equal the input schema (pass-through, no data sampling required on analyze).

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

### Requirement: Dedupe op UI config component
The system SHALL provide a `DedupeConfig` component with a multi-select for key fields (drawn from
the step's known input columns) and a first/last toggle for the `keep` value. Leaving the key
multi-select empty SHALL be a valid configuration (whole-row distinct). The component SHALL call
`onChange` with the serialized config JSON on every change.

#### Scenario: User selects key fields
- **WHEN** user selects `id` and `region` from the key multi-select
- **THEN** onChange is called with a config JSON whose `keys` is `["id", "region"]`

#### Scenario: User leaves keys empty for whole-row distinct
- **WHEN** user selects no key fields
- **THEN** onChange is called with a config JSON whose `keys` is `[]`

#### Scenario: User toggles keep to last
- **WHEN** user switches the keep toggle from "first" to "last"
- **THEN** onChange is called with a config JSON whose `keep` is `"last"`

### Requirement: Dedupe op is available in the pipeline editor
The system SHALL include a "Dedupe rows" (or equivalent distinct/dedupe label) entry in the op-type
dropdown of the pipeline editor. Selecting it SHALL create a step with op `"dedupe"` and an initial
config of `{"keys": [], "keep": "first"}`. The step card body SHALL render `DedupeConfig` when the
step op is `"dedupe"`.

#### Scenario: Adding a dedupe step
- **WHEN** user selects the dedupe entry from the op dropdown
- **THEN** a new step is created with op `"dedupe"` and config `{"keys":[],"keep":"first"}`

#### Scenario: Editing a dedupe step
- **WHEN** the step card for a dedupe step is expanded
- **THEN** `DedupeConfig` is rendered with the current `keys`/`keep` values

