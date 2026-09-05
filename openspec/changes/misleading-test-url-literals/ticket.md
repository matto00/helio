# HEL-980: PipelineRunServiceSpec uses misleading example.com literals for a seam that never fetches

## Description

This ticket was originally filed as "two tests reach a live external domain (example.com)". **That premise was refuted during premise validation.** Neither test makes any outbound request, and no test anywhere in the backend suite does.

The seam analysis, deterministic and short:

1. `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala:134` constructs `PipelineRunService` without the `system` argument.
2. `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:59` declares `system: ActorSystem[_] = null`.
3. `PipelineRunService.scala:90-92` — `urlFetchSeam` short-circuits on `system == null`, returning `Left("URL-backed source fetch is not configured")` before any of the `CsvUrlFetch.fetch` / `ContentSourceSupport.fetchUrlWithLimit` branches at `:96-100`.
4. That seam is the only path `InProcessPipelineEngine` uses for a URL-backed source (`InProcessPipelineEngine.scala:513/541/565/597`); the engine's own constructor default (`:157`) is likewise a non-fetching `Left`.

The real defect is far smaller: the fixture *literals* read like live network calls, which is how three separate passes (the HEL-881 evaluator, the HEL-881 final-gate skeptic, and this ticket's author) came to believe a network dependency existed. The owner's decision was to swap the literals as cheap insurance against paying that misreading cost a fourth time — not to treat it as a network fix.

## Acceptance Criteria

- [ ] The three `example.com` literals in `PipelineRunServiceSpec.scala` (lines 939, 972, 1014 — `seedCsvUrlDs` and `seedTextUrlDs` call sites) are replaced with a `.test` reserved-TLD host matching the convention already used by `PipelineRunRoutesSpec.scala:199-200` and `InProcessPipelineEngineSpec.scala:52-53`.
- [ ] Both named tests still assert exactly the same outcomes they assert today (`Left`, `ServiceError.UnprocessableEntity`, `status shouldBe "failed"`, `errorLog shouldBe Some("Pipeline execution failed")`). No assertion is weakened, added, or removed.
- [ ] No local HTTP server is introduced. The tests continue to exercise the seam while it is UNWIRED — that is what they discriminate.
- [ ] The negative grep sweep of `backend/src/test/` for live external hosts is recorded durably in the PR description.
- [ ] `sbt test` passes for `PipelineRunServiceSpec`.

## Out of scope

- Standing up a local akka-http test server (the original ticket's proposed fix). Explicitly ruled out by the owner: wiring a real server would obscure what these tests discriminate.
- Any change to `PipelineRunService`, `InProcessPipelineEngine`, or any production code. This change touches test literals only.
- Any database migration. HEL-981 and HEL-975 are live concurrently on the shared dev Postgres.
