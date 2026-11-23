## MODIFIED Requirements

### Requirement: Items equal the per-pipeline analyze route
Each item's `steps` and `warnings` SHALL equal, element for element and field for field, the `steps` and `warnings`
of `GET /api/pipelines/:id/analyze` (no `concise`) for that pipeline and the same caller, at the same data. This
SHALL hold for multi-root and branched pipelines, disabled steps, steps with a `validationError`, join and lookup
steps reading a secondary source, `upsertsource` steps whose existing-source target is missing, foreign or not a
dataset, and pipelines with non-blocking analyze warnings. Every source id (root, join/lookup secondary, upsert
target) SHALL be looked up by its raw stored value, compared as text exactly as `/analyze` compares it: an id that is
not the canonical lower-case form of an existing source's id (for example its upper-case form) or that is not a
well-formed UUID SHALL resolve to no source in the batch exactly as it does in `/analyze`, and SHALL NOT cause the
pipeline's item to be omitted.

#### Scenario: Rich pipeline parity
- **WHEN** the caller owns pipelines covering each case above
- **THEN** every item's `steps` and `warnings` deep-equal that pipeline's analyze response fields

#### Scenario: Non-canonical source id
- **WHEN** a stored step names a secondary source or an upsert target by the upper-case form of an existing source id
  the caller owns
- **THEN** that pipeline's item is present and its `steps` and `warnings` deep-equal that pipeline's analyze response
  fields

#### Scenario: Malformed source id
- **WHEN** a stored step names a secondary source or an upsert target by a string that is not a UUID
- **THEN** that pipeline's item is present and its `steps` and `warnings` deep-equal that pipeline's analyze response
  fields

#### Scenario: A pipeline whose analysis cannot be produced
- **WHEN** producing one pipeline's analysis (its projection or a source lookup) fails on the server
- **THEN** that pipeline's item is omitted, the other items are still returned, and the response is `200`

#### Scenario: A stored step that cannot be decoded
- **WHEN** a stored step row of any listed pipeline has a config that cannot be decoded
- **THEN** the read fails with a non-2xx status, exactly as `GET /api/pipelines/context-details` does on the same row,
  and a client falls back to per-pipeline analyze
