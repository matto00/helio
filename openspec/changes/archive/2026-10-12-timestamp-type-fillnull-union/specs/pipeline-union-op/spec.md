## MODIFIED Requirements

### Requirement: Union op analyze-inference is a documented best-effort passthrough
The `analyze_pipeline` endpoint SHALL infer a `union` step's output schema through a dedicated
dispatch case (not the unknown-op fallback). When the secondary input is `source`-kind, its schema is
not resolved at analyze time for `union`, and the inferred output schema SHALL equal the input schema
unchanged, with no `validationError`; this is a documented, intentional limitation (it also means the
timestamp/numeric collision check below cannot fire for a `source`-kind secondary). When the secondary
input is `lane`-kind and its schema is resolved, the inferred output schema SHALL be the input schema
followed by every secondary field whose name is not already present (on a name collision the parent
lane's type is projected).

#### Scenario: Analyze passes the input schema through unchanged
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "union", "config":
  {"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byName"}}` whose input schema contains fields `a` (int) and
  `b` (int)
- **THEN** the inferred output schema is exactly `a` (int), `b` (int) — unchanged — and no
  `validationError` is present in the response

#### Scenario: A lane-kind secondary's new fields are appended
- **WHEN** analyze is called for a `union` step whose parent lane projects `{a: string, b: string}` and
  whose `lane`-kind secondary projects `{a: string, c: integer}`
- **THEN** the inferred output schema is `a` (string), `b` (string), `c` (integer)

## ADDED Requirements

### Requirement: Analyze flags a timestamp-versus-numeric field collision in a union
When a `union` step's secondary input schema is resolved (`lane`-kind), analyze SHALL report a
`validationError` for that step if a field name appears on both sides with type `timestamp` on one
side and `integer` or `float` on the other. The message SHALL name every such field and both of its
types, and SHALL suggest casting one side so the types match. The projected output schema SHALL be
the same as without the error. Every other same-name collision SHALL keep the parent lane's type with
no error. When the secondary schema is not resolved (including every `source`-kind secondary — a
known gap), no error is reported. The step's run-time behaviour is unchanged and runs are not blocked
by this error; it flags the disagreement, it does not prevent it.

#### Scenario: A numeric secondary field under a parent timestamp field is an analyze error
- **WHEN** analyze is called for a `union` step whose parent lane projects `ts: timestamp` and whose
  `lane`-kind secondary input projects `ts: integer`
- **THEN** the union step carries a `validationError` naming `ts`, `timestamp` and `integer`

#### Scenario: The reverse direction is also an error
- **WHEN** the parent lane projects `ts: float` and the `lane`-kind secondary projects `ts: timestamp`
- **THEN** the union step carries a `validationError` naming `ts`

#### Scenario: The run still mixes numbers into the column (flagged, not prevented)
- **WHEN** that union is run over a parent lane with timestamp-string `ts` values and a secondary
  lane with numeric `ts` values
- **THEN** the output `ts` column contains numbers, which is the disagreement the analyze error
  reports

#### Scenario: Other collisions are unchanged
- **WHEN** the colliding field is `string` on one side and `timestamp` on the other, or `integer`
  on one side and `float` on the other, or the same type on both sides
- **THEN** no `validationError` is reported and the parent lane's type is projected

#### Scenario: A source-kind secondary is not checked
- **WHEN** the union's secondary input is `source`-kind
- **THEN** no `validationError` is reported, whatever the source's field types (known gap)
