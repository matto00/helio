# Pipeline step parity corpus (HEL-1581)

The shared vectors that hold the TypeScript client step evaluator
(`frontend/src/features/pipelines/evaluator/`) to the Scala engine. Two runners read these files:

- **Scala oracle** — `backend/src/test/scala/com/helio/domain/engine/PipelineStepParitySpec.scala` runs every vector through
  `InProcessPipelineEngine.executeTree` (the engine's run path: `requiredConfigProblems` before `evaluate`, `enabled` and
  `position` honoured) and checks the stored expectation against what the engine produced.
- **Jest** — `frontend/src/features/pipelines/evaluator/pipelineStepParity.test.ts` runs the same files through the evaluator.

A vector is only trusted once the Scala spec is green on it, so an expectation is never hand-written: leave `expect` out of a new
vector (or `scala`/`frames`/`framesWithout`, and `"rows": "scala"` in a walk vector's `client` block) and fill it from the engine with

```bash
cd backend && PARITY_REGEN=1 sbt "testOnly com.helio.domain.engine.PipelineStepParitySpec"
npx prettier --write shared-test-fixtures/pipeline-step-parity
```

Regeneration only fills what is missing; it never overwrites an existing expectation. Review what it wrote before committing.

## Files

- `manifest.json` — classifies all 27 registered kinds (`client`, `client*`, `identity`, `server`) with `minVectors` and `features`.
  The compute function, operator and literal lists live in `../compute-expression-functions.json`, not here.
- `<kind>.json` — step vectors for each non-server kind: `{name, config, inputRows, enabled?, secondary?, expect}`.
  `expect` is `{rows}`, `{error: true}` or `{clientDeclines: <reason>, scalaRows | scalaError: true}`.
  `secondary` is `{kind: "lane", rows, complete}` or `{kind: "source", id, rows, complete}`.
- `pipelines.json` — walk vectors: `{name, rootFrames, steps, scala, client}`. `scala` is `{frames}`, `{failsAt, framesWithout}`,
  `{laneError: true, removed, framesWithout}` or `{notRun, framesWithout}`; `client` is `{<stepId>: {status, rows?, reason?}}`, and every
  `rows` there must equal a Scala-verified frame of the same vector.

## Values

A plain JSON number is a `Double`; `{"$int": n}` and `{"$long": "n"}` are an `Int` and a `Long`; `{"$double": "NaN" | "Infinity" |
"-Infinity" | "-0.0"}` carries the doubles JSON cannot. Values compare by value **and** class, in both directions. Row order is compared;
column order is not. See `manifest.json` `notes` for the known gaps (Long precision beyond 2^53, hash-collision order, non-transitive
window ordering).
