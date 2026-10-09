## Context

See proposal.md - Why. Current tree (origin/main 96f2ae97):

- `schemas/pipelines/pipeline-analyze-response.schema.json` `$defs.AnalyzeStep`: required
  `[id, position, type, config, inputSchema, outputSchema]`, `type: string`, `config: object`, optional
  `validationError`, `additionalProperties: false`.
- `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` `$defs.AnalyzeProposalStep`: same required list and
  fields; differs only in `type.minLength: 1` and an explicit `config.additionalProperties: true` (the JSON Schema default).
- The stale claim appears at line 5 (top-level `description`) and line 101 (`AnalyzeProposalStep.description`).
  `git grep -i` finds no other tracked, non-archived file carrying it.
- HEL-1235 (7e1df62a) touched this file (added `warnings`) without touching either sentence.

## Goals / Non-Goals

**Goals:** both `description` strings become true; AC 2 answered with a recorded rationale.

**Non-Goals:** see proposal.md - Non-goals.

## Decisions

### D1. Keep the local `AnalyzeProposalStep` copy; do not cross-file `$ref` the response schema's `AnalyzeStep`

The proposal schema is compiled standalone by the backend test harness:
`PipelineAnalyzeProposalRoutesSpec` test 3.11 calls
`JsonSchemaValidation.compile("pipelines/pipeline-analyze-proposal-response.schema.json")`, which feeds the file to
networknt `JsonSchemaFactory` via `readTree` with no URI/schema mapping
(`backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala`). A cross-file `$ref`, relative or absolute,
resolves against this schema's `$id` `https://helio.local/...`, a host that does not resolve (`getent hosts helio.local`
returns nothing; `git grep` finds no URI mapping in `backend/src/test`). `DataSourceRoutesSpec.scala` lines 201-203
records the same limitation: it validates each entry schema separately because its top-level schema's cross-file `$ref`s
are "an unresolvable host offline". None of the 11 distinct schemas the harness compiles uses a cross-file `$ref`.

Alternatives considered:
- `$ref` + add a URI mapping to the harness: test-infrastructure work beyond a Low description fix; would deserve its
  own ticket covering every duplicated def, not one.
- `$ref` + drop/split test 3.11: weakens an existing contract test to fix a comment. Rejected.

### D2. Replacement text

Each OLD string occurs exactly once in the schema file (each inside one JSON string value; neither contains a double
quote). Replace it with its NEW string verbatim. Neither NEW string contains the word "stale".

A-OLD (line 5, top-level description, tail of the string):

```text
The steps[] shape mirrors the ACTUAL discriminated-union wire format analyzeStepResponseFormat already emits (a `type` discriminator plus an object `config`), NOT pipeline-analyze-response.schema.json's stale `op`/string-`config` $defs.AnalyzeStep, which predates the CS2c-3a discriminated-union rework (design.md D6).
```

A-NEW:

```text
The steps[] shape mirrors the discriminated-union wire format analyzeStepResponseFormat emits (a `type` discriminator plus an object `config`) -- the same fields as pipeline-analyze-response.schema.json's $defs.AnalyzeStep, which HEL-1266 corrected to that shape (design.md D6). It is kept as a local copy, $defs.AnalyzeProposalStep, rather than a cross-file $ref: the backend schema test harness compiles this file standalone and cannot resolve a cross-file $ref by $id offline (HEL-1281).
```

B-OLD (line 101, $defs.AnalyzeProposalStep.description, first sentence):

```text
Matches the actual analyzeStepResponseFormat wire shape (type discriminator + object config) -- a deliberate divergence from pipeline-analyze-response.schema.json's stale $defs.AnalyzeStep (op/string-config, pre-CS2c-3a).
```

B-NEW:

```text
Matches the analyzeStepResponseFormat wire shape (type discriminator + object config) -- the same fields as pipeline-analyze-response.schema.json's $defs.AnalyzeStep (corrected by HEL-1266). A local copy rather than a cross-file $ref, which the backend schema test harness cannot resolve offline (HEL-1281); keep the two in step.
```

Both keep the existing `design.md D6` reference where present (HEL-381's design doc) and point at this ticket so the
rationale for the copy is findable from the contract file itself.

## Risks / Trade-offs

- [The two step defs can still drift silently] → unchanged from today; recorded as a non-goal. The new text says the
  copies must be kept in step.
- [A `description` edit breaks JSON] → tasks verify with `node -e` JSON.parse, `prettier --check`, and `check:schemas`.

## Planner Notes

- `skip_specs: true`: annotation-only change, no requirement changes (self-approved).
- Line 101 is in scope although the ticket names only "the description": same defect, same file (self-approved).
