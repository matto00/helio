## Purpose
Defines the single bounded traversal that enumerates a JSON object's leaf values as dot-separated paths, and
the guarantee that a data source's advertised field schema and its materialised rows are both derived from
that one traversal — so a nested field present in one is necessarily present in the other.

**Known limitation (design.md D9), documented here per that decision:** a dotted column produced by this
traversal (e.g. `stats.pts_ppr`) cannot be referenced from either surface that runs expressions through
`ExpressionEvaluator` — pipeline `compute`/`filter` steps, and source computed fields
(`SourceService.applyComputedFields`) — because the evaluator's tokenizer does not admit `.` in an
identifier. Key-addressed steps (`select`, `lookup`, `sort`, `dedupe`, `rename`) are unaffected and address a
dotted column exactly like any other key. The documented workaround is a `rename` step (or, for source
computed fields, a field override) mapping the dotted column to a plain identifier before it needs to appear
in an expression. Admitting `.` into the expression lexer is out of scope here and is filed as a follow-up
ticket (see the PR body).

## ADDED Requirements

### Requirement: Shared leaf traversal over nested JSON objects
The system SHALL provide one traversal that, given a JSON object, enumerates its leaves as
`(dotted path, leaf value)` pairs. A nested object contributes no leaf of its own; it contributes its
descendants' leaves, each keyed by the dot-joined path from the root. Every value that is not an object is a
leaf. Schema inference, row materialisation, and source preview SHALL all be derived from this traversal, so that
for any input object the set of field names in the inferred schema is exactly the set of column keys in the
materialised row, and exactly the set of keys shown in preview.

#### Scenario: Nested object contributes dotted leaves, not itself
- **WHEN** the traversal is applied to `{"player": {"first_name": "Malik", "last_name": "Davis"}}`
- **THEN** it yields exactly the paths `player.first_name` and `player.last_name`, and no path `player`

#### Scenario: Multiple levels of nesting
- **WHEN** the traversal is applied to `{"player": {"metadata": {"rookie_year": "2022"}}}`
- **THEN** it yields exactly the path `player.metadata.rookie_year`

#### Scenario: Top-level scalars are unchanged
- **WHEN** the traversal is applied to `{"player_id": "8800", "team": "DAL"}`
- **THEN** it yields exactly the paths `player_id` and `team`, with their original values

#### Scenario: Schema and rows agree on the same input
- **WHEN** a schema is inferred from a nested JSON object and a row is materialised from that same object
- **THEN** the set of inferred field names equals the set of row column keys

#### Scenario: Source preview agrees with schema and rows
- **WHEN** a source's preview rows are produced for a response containing nested objects
- **THEN** the preview's column keys are the same dotted keys as the inferred schema and the executed rows,
  and no preview column holds a nested object

#### Scenario: An empty nested object contributes no columns
- **WHEN** the traversal is applied to `{"a": 1, "meta": {}}`
- **THEN** it yields only the path `a`, and the inferred schema likewise has no `meta` field

### Requirement: Arrays terminate traversal as leaves
An array value SHALL be a leaf regardless of its element types — both an array of scalars and an array of
objects. The traversal SHALL NOT descend into array elements and SHALL NOT generate index-bearing paths. A
leaf array's materialised row value SHALL be its compact JSON text, and its inferred type SHALL be the string
type, so schema and row agree.

#### Scenario: Array of scalars is a single leaf
- **WHEN** the traversal is applied to `{"tags": ["a", "b"]}`
- **THEN** it yields exactly the path `tags`, and no `tags.0` path

#### Scenario: Array of objects is a single leaf
- **WHEN** the traversal is applied to `{"games": [{"pts": 1}, {"pts": 2}]}`
- **THEN** it yields exactly the path `games`, and no `games.0.pts` path

#### Scenario: Array inside a nested object is still a leaf at its dotted path
- **WHEN** the traversal is applied to `{"stats": {"weeks": [1, 2, 3], "pts_ppr": 33.7}}`
- **THEN** it yields exactly the paths `stats.weeks` and `stats.pts_ppr`

#### Scenario: Leaf array materialises as JSON text typed as string
- **WHEN** a row is materialised from `{"tags": ["a", "b"]}` and a schema is inferred from it
- **THEN** the row's `tags` value is the JSON text `["a","b"]` and the inferred `tags` field is the string type

### Requirement: Bounded traversal depth
The traversal SHALL apply a fixed maximum nesting depth. An object encountered at the depth bound SHALL be
treated as a leaf rather than descended into, identically in schema inference and row materialisation, so the
two remain in agreement at and beyond the bound. The traversal SHALL NOT fail, truncate the row, or raise an
error on input nested more deeply than the bound.

#### Scenario: Nesting within the bound is fully expanded
- **WHEN** an object nested less deeply than the bound is traversed
- **THEN** every scalar leaf is reachable at its full dotted path

#### Scenario: An object at the depth bound becomes a leaf
- **WHEN** an object nested more deeply than the bound is traversed
- **THEN** the subtree at the bound yields a single leaf whose row value is its compact JSON text and whose
  inferred type is the string type, and no deeper path is generated

#### Scenario: Over-deep input does not error
- **WHEN** a source returns objects nested far beyond the bound
- **THEN** rows are still materialised and the schema is still inferred, with no failure and no dropped
  top-level column

### Requirement: Deterministic dotted-key collision resolution
When a literal key containing a dot collides with a path generated from nesting (for example a key `a.b`
alongside an object `a` containing key `b`), the traversal SHALL resolve the collision deterministically, and
schema inference and row materialisation SHALL resolve it the same way, so the two never disagree about which
value a column holds.

#### Scenario: Literal dotted key and generated path collide
- **WHEN** an object contains both a literal key `a.b` and an object `a` containing key `b`
- **THEN** exactly one `a.b` column exists, the inferred schema and the materialised row select the same one
  of the two values, and the outcome is stable across repeated runs on the same input
