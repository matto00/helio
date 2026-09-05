## Why

Three `example.com` literals in `PipelineRunServiceSpec.scala` read like live outbound HTTP calls, but the fetch seam
they flow into is unwired in that fixture and returns a `Left` before any network branch. The appearance was
convincing enough to mislead three separate passes — the HEL-881 evaluator, the HEL-881 final-gate skeptic, and the
author of HEL-980, who filed it as a network-dependency bug that does not exist. That misreading cost has now been
paid once; swapping the literals to a reserved TLD is cheap insurance against paying it again.

## What Changes

- Replace three `https://example.com/...` literals in
  `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` (the `seedCsvUrlDs` call site and
  both `seedTextUrlDs` call sites) with a `.test` reserved-TLD host, matching the convention already established by
  `PipelineRunRoutesSpec.scala:199-200` and `InProcessPipelineEngineSpec.scala:52-53`.
- No assertion is added, removed, or weakened. No production code is touched.
- Record the negative grep sweep of `backend/src/test/` — no test in the backend suite reaches a live external host —
  in the PR description, so the result survives beyond this run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change alters test fixture literals only; no requirement or observable behavior changes. `skip_specs: true`
is set in `.openspec.yaml` accordingly — inventing a requirement here to satisfy validation would be exactly the kind
of evidence-shaped non-evidence this ticket is about.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — three string literals.
- No migration, so no contention with the concurrent HEL-981 / HEL-975 runs on the shared dev Postgres.
- No API, schema, dependency, or frontend impact.

## Non-goals

- **Standing up a local akka-http test server.** The original ticket proposed this. It is explicitly rejected: these
  tests exist to exercise the URL-fetch seam while it is UNWIRED, and wiring a real server would obscure what they
  discriminate.
- **Any change to `PipelineRunService` or `InProcessPipelineEngine`.** The seam behaves correctly; there is no defect
  in it.
- **An egress-blocked empirical test run.** The refutation rests on a deterministic read of a short code path plus a
  tree-wide grep. That is proportionate here and is deliberately not overclaimed as empirical network isolation.
