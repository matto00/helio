## Why

Two pipeline ops can put a JSON number into a column whose analyze-projected type is `timestamp`
(HEL-1314 evidence: `timestamp-paths-evidence.md`). Analyze then disagrees with the run: a downstream
`compute` `$ts + …` is inferred `string` (a timestamp is text at run time) while the run produces a
number. HEL-1314 shipped with these two paths documented as a known limitation and spun them off here.

## What Changes

- **fillnull:** analyze reports a `validationError` on a `fillnull` step whose strategy is `mean` or
  `median` and which lists a column whose projected input type is `timestamp`. The step stays
  saveable (no write-time rejection: the save path has no input schema, and HEL-1416 keeps drafts
  saveable). The error shows on the step card and sets `canRun: false` in the analyze response, which
  only hides the editor's "Run to update" prompt. **This flags the disagreement; it does not remove
  it:** the Run pipeline / Dry run buttons ignore `canRun`, scheduled and auto runs are not gated
  (HEL-1280), run-time behaviour is unchanged (rows carry no types at run time), and the projected type
  stays `timestamp`, so a downstream `$ts + …` is still inferred `string` while a run that is started
  anyway still writes a number.
  `constant`, `forwardFill` and `mode` on a timestamp column are unaffected.
- **union:** analyze reports a `validationError` on a `union` step whose resolved secondary schema has
  a same-named field where one side is `timestamp` and the other is numeric (`integer`/`float`).
  Every other name collision keeps today's projection (parent lane's type wins). Run-time behaviour is
  unchanged, with the same "flags, does not remove" limits as fillnull above.
- **Known gap (not fixed here):** a union whose secondary input is a **data source** (`source`-kind,
  the default shape). Analyze resolves a source secondary's schema only for `join`/`lookup`, so the
  union check cannot see the source's types and does not fire; the run still puts numbers under
  `timestamp` there. Extending the source-schema lookup to `union` would change the projected schema
  of every existing source-kind union (secondary-only columns would start appearing), which is its
  own product call; it is filed as a follow-up.
- **Assumed product calls (OWNER REVIEW):** both fixes choose "flag as an analyze step error" over the
  alternatives (fillnull: produce a timestamp; union: widen to `string` or warn). Rationale in
  design.md. Visible to existing pipelines: a pipeline already containing either shape newly shows a
  step error and `canRun: false` in the editor; scheduled/auto runs are not gated (HEL-1280 policy).
- `docs/compute-expression-grammar.md` "Known limitation" section updated to describe the shipped
  behaviour.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-fillnull-op`: analyze flags `mean`/`median` on a timestamp-typed column as a step error.
- `pipeline-union-op`: analyze flags a timestamp-versus-numeric same-name field collision with a
  resolved (`lane`-kind) secondary input; the stale "analyze is a passthrough" requirement is
  corrected to the shipped HEL-911 behaviour (source-kind passthrough, lane-kind field union).

## Impact

- Backend only: `domain/engine/StepSchemaInference.scala` (fillnull dispatch arm),
  `domain/engine/MultiInputSchemaInference.scala` (`inferUnion`), possibly a small helper in
  `domain/steps/FillNullStep.scala` for the message; new pure unit parity spec(s) under
  `backend/src/test/scala/com/helio/domain/engine/`.
- No API shape change, no migration, no frontend change (step `validationError` renders generically).
- Docs: `docs/compute-expression-grammar.md`.
