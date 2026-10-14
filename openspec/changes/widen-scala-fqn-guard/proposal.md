## Why

HEL-1385 moved inline `scala.util.Try` / `scala.collection.mutable` FQNs into the new engine objects, and the
`check:scala-quality` guard did not catch them because its prefix list covers only `scala.concurrent.` and
`scala.annotation.` from the `scala` namespace. The same split left scaladoc/docs/spec references naming
`PipelineAnalyzeService` members that now live on other objects, plus a few cosmetic nits.

## What Changes

- Widen the inline-FQN guard to the whole `scala.` namespace (subsuming `scala.concurrent.`/`scala.annotation.`), with
  selftest red cases for `scala.util.`, `scala.collection.` and `scala.io.` that fail on the old guard.
- Fix every inline `scala.*` use the widened guard flags across `backend/src/{main,test}/scala` (76 sites, 39 files)
  by importing; no behaviour change.
- Re-point stale `PipelineAnalyzeService.<moved member>` references (scaladoc, `steps/README.md`, `docs/`, canonical
  specs) at their current owner (`StepConfigValidation`, `ColumnSchemaInference`, `MultiInputSchemaInference`,
  `TextSchemaInference`, …).
- Cosmetic: wrap the 127-char `stepConfigProblem` line, drop stray blank lines, rewrap ragged
  `PipelineAnalyzeProtocol` scaladoc.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `scala-inline-fqn-guard`: the guard covers the whole `scala.` namespace.
- `pipeline-compute-op`, `pipeline-split-text-op`, `pipeline-extract-headings-op`, `pipeline-chunk-by-token-count-op`:
  the schema-inference requirement names the inference function's current owning object (reference only, no
  behaviour change).

## Impact

`scripts/check-scala-quality.mjs` + selftest, `CONTRIBUTING.md` (guard description), ~41 Scala files (imports only),
scaladoc/docs/spec text. No runtime, API, schema or migration change.

## Non-goals

- HEL-1386 (FQNs inside `s"${...}"` splices are blanked with the string and not scanned) stays its own ticket.
- No other guard behaviour change (exemptions, file-size warnings unchanged).
