# HEL-262: Compute column step rework — multi-column, $col refs, constants, string ops

## Description

The Compute step is the workhorse transformation op but is brittle today. Multi-column references don't work reliably, and the syntax is unclear.

## Target capabilities

* **Multi-column references** — `$colA + $colB * 2` works
* `$col` syntax for variable references (replaces whatever ad-hoc thing is there now)
* **Numeric constants** — `$amount * 1.05`
* **String literals** — `$first_name + " " + $last_name`
* **String operations** (brainstorm during execution) — concat, substring, lower/upper, length

## Brainstorm during execution

* Should `$` be required or just an option? (Hard to disambiguate `col + 5` if `col` could be a variable OR a string)
* Should we support function-call syntax like `concat($a, " ", $b)`?
* Type coercion rules when columns are mixed types
* Error reporting — where does a bad expression surface in the UI?

## Definition of done

* Compute step expression evaluator handles all listed capabilities
* Step config UI exposes the variable references clearly (autocomplete from current input schema is a stretch goal)
* Backend + frontend share one expression-syntax doc (or co-located grammar)
* Tests cover each operation type with multiple example expressions
* Existing single-column compute uses still work

Coordinate with [[feedback_pipeline_op_wiring]] (op apply/infer parity).

## Orchestrator notes (from delivery-run instructions)

This ticket has explicit open design questions the description flags as
"brainstorm during execution":

1. Whether the `$` prefix is required or optional for column refs.
2. Whether to support function-call syntax like `concat($a, $b)`.
3. Type-coercion rules for mixed-type columns.
4. Where bad-expression errors surface in the UI.

**Planning must make a clear recommendation for each in the proposal, but these
are to be ESCALATED to the human rather than decided unilaterally** — they shape
the expression grammar users will depend on.

Also coordinate with the pipeline-op-wiring checklist (apply/infer parity, allowedOps,
Flyway migration for the op's persisted shape, StepCard UI wiring) recorded in project
memory as `feedback_pipeline_op_wiring`:

- New pipeline op wiring requires parity between the "apply" path and the "infer"
  (schema-preview) path — both must handle the same expression grammar and produce
  consistent output-column types.
- Any new/changed step-config shape needs `allowedOps` updated wherever ops are
  enumerated for validation.
- If the step's persisted JSON shape changes, a Flyway migration is needed for
  existing dashboards' persisted pipeline configs (if compute steps are stored
  with the old ad-hoc syntax, consider a migration or backward-compatible parse
  path).
- `StepCard` (frontend pipeline step UI) wiring must expose the new config
  surface (expression input, variable reference hints).
