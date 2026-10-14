## Why

HEL-1412 corrected several "single source of truth" overclaims but left five more comments that assert a completeness
the code does not enforce (a non-sealed trait called sealed, a match on `Any` called a compile error, a stale
`upsertsource` note, a stale step count, two "single source of truth" claims). Readers act on these claims and skip
layers. Separately, HEL-1412's panel-kind coverage check only sees `enum` arrays, so the per-branch `const`
discriminators in `panel.schema.json`'s `oneOf` and `create-panel-request.schema.json`'s `allOf` if/then sit outside
it, and its keys depend on the OS path separator.

## What Changes

- Rewrite the five comment sites to the HEL-1156 standard: no completeness claim, name the known layers, give a
  re-derive command. Rename the `PipelineStepSpec` test whose name claims compile-time exhaustiveness.
- Extend `scripts/lib/panelKindEnumCoverage.mjs` to detect panel-kind `const` groups across combinator branches and
  normalize coverage keys to `/`.
- Parity-check the two existing const groups in `scripts/check-schema-drift.mjs`.
- Add red-first self-test cases to `scripts/check-schema-drift.selftest.mjs`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `schema-drift-panel-kind-coverage`: coverage also covers panel kinds carried as per-branch `const` values under
  `oneOf`/`anyOf`/`allOf`, and coverage keys are path-separator independent.

## Non-goals

- No runtime behavior change in backend or frontend. Scala edits are comments and one test name, plus at most one
  behavior-preserving switch of the `upsertsource` arm in `encodeConfig` to the Registry form (design D3), made only
  when proven equivalent.
- No `$ref` resolution in the coverage scan (stated limit, see design.md).
- HEL-1474 (EmbeddedPostgres start-guard) is another lane's work.

## Impact

- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala`,
  `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala`,
  `backend/src/main/scala/com/helio/domain/steps/README.md`,
  `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala`,
  `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala`.
- `scripts/lib/panelKindEnumCoverage.mjs`, `scripts/check-schema-drift.mjs`, `scripts/check-schema-drift.selftest.mjs`.
