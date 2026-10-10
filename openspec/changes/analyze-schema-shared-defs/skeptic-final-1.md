## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `761da4efbd5537638aba49871329e996eeaf4231`. The base was resolved live with `resolve-review-base.sh` and gave `a703ac5648115397afdb34cc086e14a356c1d160`. No UI changed, so step 4 was skipped. Every mutation was reverted, and `git status` afterwards showed only the evaluator's untracked `evaluation-1.md`.

### What I verified (with evidence)

**AC1: URI mapping in the harness.** `JsonSchemaValidation.scala` now builds one factory, a `private lazy val factory`. It uses `URITranslator.prefix("https://helio.local/schemas/", schemaFile("").toURI.toString)`, and `compile` calls `factory.getSchema(...)`. Callers keep their signatures. Mutation M1 put back the old `JsonSchemaFactory.getInstance(...)` compile. The guard then failed 7 of 9 tests with `java.net.UnknownHostException: helio.local` (`/tmp/hel1419-skf-m1.txt`), so the mapping is what makes the refs resolve.

**AC2: duplicated defs replaced; no copy remains.**
- The diff removes `AnalyzeWarning`, `RootSourceSchema`, `SchemaField` and `AnalyzeProposalStep` from the proposal schema. `$defs` now holds only `OutputAnalyze`, and I read the whole file to confirm this.
- The `sourceSchemas`, `steps` and `warnings` items now `$ref` the absolute URI `https://helio.local/schemas/pipelines/pipeline-analyze-response.schema.json#/$defs/{RootSourceSchema,AnalyzeStep,AnalyzeWarning}`.
- I compared the removed copies with the canonical defs after stripping descriptions, using a Python script against `git show a703ac564:...`:
  - `AnalyzeWarning`, `RootSourceSchema` and `SchemaField` were identical.
  - `AnalyzeProposalStep` and `AnalyzeStep` differed in only two places. The first was `type.minLength: 1`, which this change adds to the canonical def. The second was `config.additionalProperties: true` against absent, which means the same thing in 2020-12. The `$ref` swap therefore does not loosen or tighten anything for the proposal response.
- D4 tightening: `analyzeStepResponseFormat.write` (`PipelineAnalyzeProtocol.scala:369-400`) always writes `"type" -> JsString(s.type)` from a closed sealed set of step-kind responses, so the wire never sends an empty type.
- No stale "local copy" or `AnalyzeProposalStep` prose is left in `schemas/`, `backend/src`, `frontend/src` or `docs` (grep).

**AC3: specs, `check:schemas` and schema drift stay green.** Both checks ran fresh.
- `node scripts/check-schema-drift.mjs` exited 0 with "schemas in sync with JsonProtocols (122 checked across 54 protocol files)".
- `check-schema-drift.selftest.mjs` passed all cases.
- An sbt `testOnly` run of the guard plus the four analyze specs (`PipelineAnalyzeProposalRoutesSpec`, `PipelineAnalyzeRoutesSpec`, `PipelineAnalyzeCanRunRoutesSpec`, `PipelineAnalyzeSchemaWarningsSpec`) completed 5 suites with 71 tests passed and 0 failed. The output includes "should validate cleanly against schemas/pipelines/pipeline-analyze-proposal-response.schema.json (3.11)" (`/tmp/hel1419-skf-run1.txt`).

**AC4: the guard can fail.** `AnalyzeSchemaSharedDefsSpec` caught every mutation I made.
- M1, mapping removed: 7 of 9 tests failed.
- M2, a `SchemaField` copy put back into the proposal `$defs`: the disjointness test failed with `Set("SchemaField") was not empty` (`/tmp/hel1419-skf-m2.txt`).
- M3, a renamed `StepCopy` copy wired in as the local target of `steps.items.$ref`: two tests failed, the set-equality test and the exact-URI test (`/tmp/hel1419-skf-m3.txt`).
- M4, a dangling ref (`AnalyzeWarningNope`): failed loudly with networknt `Reference ... cannot be resolved`, which shows an unresolved ref does not quietly become `{}` (`/tmp/hel1419-skf-m4.txt`).

**Driver note: every consumer still validates real responses, and through the refs.**
- Every `JsonSchemaValidation.compile` caller is in one of the 14 suites I ran. I checked all 10 non-analyze schemas they compile, and none contains an `http` `$ref`, so the mapping changes nothing for them.
- `PipelineAnalyzeSchemaWarningsSpec:243` validates a real `service.analyzeProposal` response, including a warning, against the proposal schema.
- M5 removed `"string"` from the canonical `SchemaField.type` enum. Three tests failed: proposal 3.11, the proposal-response test in SchemaWarnings and the full-response test in SchemaWarnings (`/tmp/hel1419-skf-m5.txt`). The real-response consumers do enforce the shared defs through the cross-file ref.

**Fresh test run in place of a full `testFull`.** After reverting everything, I ran all 14 suites that use `JsonSchemaValidation`: 14 suites completed, 330 tests passed, 0 failed (`/tmp/hel1419-skf-run2.txt`). I decided a full `testFull` was not needed for this change. The diff is test-only harness code plus two schema JSON files, and the only things that read those files are these suites and `check-schema-drift.mjs`, which I also ran.

### Verdict: CONFIRM

### Non-blocking notes
- Tooling hazard, outside this ticket: `sbt testOnly` exited 0 and printed `[success]` even with `*** 7 TESTS FAILED ***` in the M1 run. I judged pass or fail only from the ScalaTest `Tests:` lines, never from the exit code. Any gate that trusts the sbt `testOnly` exit status in this repo is blind to failures.
- The executor's claim of 472 suites under `testFull` is still unverified by me. I ran the targeted consumer set instead, for the reason given above.
- No screenshots or measurement artifacts were cited, so nothing was persisted beyond this report.
