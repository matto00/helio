## MODIFIED Requirements

### Requirement: Inline source resolution reuses existing inference/guard calls
Analyzing a proposal with one or more inline roots SHALL resolve **each** such root's schema using
the same inference calls the existing source-creation/inference endpoints already use, not a second,
divergent implementation. A rejection SHALL name the offending root by its request position. An
inline root with `type: "static"` or `type: "dataset"` SHALL be treated identically (HEL-1073's
write-side alias).

#### Scenario: Inline SQL source with a non-SELECT query is rejected before analysis
- **WHEN** a proposal's inline root has `type: "sql"` and a `config.query` containing a DDL/DML
  keyword (e.g. `DELETE`, `DROP`, `INSERT`)
- **THEN** the endpoint returns `400` before any query is executed

#### Scenario: Inline SQL source with a SELECT query analyzes successfully
- **WHEN** a proposal's inline root has `type: "sql"` and a `config.query` that is a `SELECT`
- **THEN** that root's source schema reflects the query's projected columns

#### Scenario: Inline static source resolves its schema from declared columns
- **WHEN** a proposal's inline root has `type: "static"` and a `config` with `columns`
- **THEN** that root's source schema matches those declared columns exactly, with no external call

#### Scenario: Inline dataset source resolves its schema from declared columns
- **WHEN** a proposal's inline root has `type: "dataset"` and a `config` with `columns`
- **THEN** that root's source schema matches those declared columns exactly, with no external call,
  identically to the `"static"` alias

#### Scenario: Inline CSV source is rejected with a clear 400
- **WHEN** a proposal's inline root has `type: "csv"`
- **THEN** the endpoint returns `400` with a message explaining that inline CSV sources require an
  uploaded file and cannot be dry-analyzed

#### Scenario: A recognized inline type with no matching config is rejected with 400, not 500
- **WHEN** a proposal's inline root has a recognized `type` (`sql`, `rest_api`, `static`, or `dataset`)
  but the request body omits that root's `config` entirely
- **THEN** the endpoint returns `400`, not an unhandled server error

#### Scenario: A fault in the second root is reported against that root
- **WHEN** a proposal's first root is a valid inline `static` spec and its second root is an inline
  `sql` spec with a non-SELECT query
- **THEN** the endpoint returns `400` naming the second root's request position
