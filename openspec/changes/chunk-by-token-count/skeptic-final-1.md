## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Acceptance criteria traced to real code/behavior:**
- *Apply/infer parity, all 8 enumeration sites*: `grep -rln "ChunkByTokenCount" backend/src/main/scala/`
  returned exactly the 9 expected files (8 enumeration sites + the new step file). Confirmed each site
  individually: `PipelineStep.scala` (Registry line 114, Kind constant line 145), `package.scala`
  (aliases), `PipelineStepProtocol.scala` (response class, format, both match arms),
  `PipelineStepConfigCodec.scala` (encode/decode arms), `PipelineStepRepository.scala` (`rowToDomain`
  arm), `PipelineAnalyzeService.scala` (`inferChunkByTokenCount` dispatch + implementation),
  `PipelineAnalyzeProtocol.scala` (case class + format + both match arms), `PipelineService.scala`
  (`toAnalyzeStepResponse` arm — the exact site that 500'd in HEL-219 cycle 1). No missed arm.
- *Live analyze-endpoint check* (not trusting the evaluator's report): started servers via
  `scripts/concertino/start-servers.sh` (reused already-healthy instances), `assert-phase.sh servers`
  → PASS. Logged in, found an existing text pipeline with a `string-body` field, added a
  `chunkbytokencount` step via `POST /api/pipelines/:id/steps` (201), then
  `GET /api/pipelines/:id/analyze` → **200**, with correct `outputSchema` (`content` still
  `string-body`, `chunkIndex`/`tokenCount` appended as `integer`), `validationError: null`.
- *Non-string-body field gating*: added a second step with `field="filename"` (a `string` field, not
  `string-body`) → analyze still 200, but `validationError: "Field 'filename' is not a content field
  (string-body); chunkbytokencount requires a string-body field"` — confirms
  `inferChunkByTokenCount`'s validation path live, not just via unit test.
- *Real chunking execution*: ran the pipeline (`POST /api/pipelines/:id/run`) with
  `targetTokenCount=2` against content `"hello world markdown content\n"` (5 o200k_base tokens) →
  got exactly 3 output rows: `("hello world", 2)`, `(" markdown content", 2)`, `("\n", 1)`. Concatenated
  decoded chunk text reconstructs the original string exactly; passthrough fields (`sizeBytes`,
  `filename`) preserved unchanged on every row. This is genuine BPE chunking, not a heuristic.
- *jtokkit API correctness*: extracted `com/knuddels/jtokkit/api/{Encoding,IntArrayList}.class` and
  `Encodings`/`EncodingType`/`EncodingRegistry` from the actual resolved `jtokkit-1.1.0.jar` via
  `javap`. Confirmed `Encoding.encode(String): IntArrayList`, `Encoding.decode(IntArrayList): String`,
  `IntArrayList(int)`/`.add(int)`/`.get(int)`/`.size()`, and `EncodingRegistry.getEncoding(EncodingType)`
  match `ChunkByTokenCountStep.scala`'s usage exactly — the code is not superficially plausible, it is
  actually correct against the real dependency.
- *UI*: navigated to the pipeline detail page in the browser, added the "Chunk by token count" step via
  the step picker (13th op, own icon, alongside all 12 existing kinds), expanded it — field dropdown
  correctly gated to only `content` (the one `string-body` field; `filename`/`sizeBytes` excluded),
  target-token-count spinbutton defaulting to 500, encoding dropdown with both labeled options. Live
  "Preview data" showed the exact chunked row matching the curl-verified output. Toggled light/dark
  theme — both render cleanly, same classnames/spacing as sibling `SplitTextConfig`/
  `ExtractHeadingsConfig` (reuses `pipeline-detail-page__splittext-config` etc., zero new CSS per the
  diff). 0 console errors throughout.
- *V52 migration*: `cat V52__add_chunkbytokencount_op.sql` — correct DROP/ADD CONSTRAINT pattern,
  lists all 13 kinds, matches V50/V51's established shape exactly. `ls .../migration | sort -V | tail`
  confirms V52 is genuinely the next free version.
- *File split, wire-shape and line budget*: read both `PipelineProtocol.scala` (95 lines) and
  `PipelineAnalyzeProtocol.scala` (194 lines) in full — the split is a clean, behavior-preserving
  relocation (same package, same trait composition restored via `with PipelineAnalyzeProtocol`), both
  comfortably under the 250-line soft budget. `npm run check:scala-quality` output lists neither file
  in its soft-warning list.

**Iron Laws / verification re-run fresh (not reused from evaluator's paste):**
- `sbt test` (backend): re-ran myself — **1248 tests, 0 failures**, Flyway migrated cleanly through
  v52 in the log.
- `npm run check:scala-quality`: re-ran myself — "clean (41 soft warning(s))", none of which are the
  two protocol files or any file touched by this change.
- `npm run lint`: re-ran myself — clean, zero warnings.
- `npm run format:check`: re-ran myself — clean.
- `npm test` (frontend): re-ran myself — **831 tests, 831 passed** across 74 suites.
- Read `ChunkByTokenCountStepSpec.scala` in full — genuine round-trip assertions
  (`encoding.encode(text).size() shouldBe tokenCount`, re-derived from decoded text, not just shape
  checks), exact-multiple and remainder boundary cases, null/absent/empty-string drop cases,
  collision and clamp cases. Read the new `PipelineAnalyzeRoutesSpec` scenario — it is the actual
  regression test for the HEL-219-class 500 bug (asserts `GET /analyze` 200 + correct schemas for a
  pipeline containing this op), matching `systematic-debugging.md`'s bar for a real regression test.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineService.scala` (424 lines) and `PipelineStepRepository.scala` (258 lines) remain
  pre-existing soft-budget violations, unrelated to this ticket. Not a blocker; flagged already by the
  evaluator as a future-split candidate.
