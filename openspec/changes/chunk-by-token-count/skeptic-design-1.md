## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **jtokkit config/dependency wiring is sound.**
   - `com.knuddels:jtokkit:1.1.0` confirmed to exist on Maven Central (`curl
     search.maven.org/solrsearch/select?q=g:com.knuddels+AND+a:jtokkit` →
     `"id":"com.knuddels:jtokkit:1.1.0"`, published 2024, tagged
     openai/tokenizer/java). Correct `%` (not `%%`) coordinate for a pure-Java
     lib, consistent with `build.sbt`'s existing pattern for other Java-only
     deps (`org.apache.pdfbox`, `com.google.cloud`).
   - `StepCodecUtil.intOr`/`stringOr` (`backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala`)
     already provide the tolerant-decode primitives decision 2 needs for
     `targetTokenCount: Int` and `encoding: String` — no new codec
     infrastructure required, decode plan is directly executable.
   - `EncodingType.O200K_BASE`/`CL100K_BASE` are real jtokkit public enum
     values; the design correctly flags the exact `IntArrayList`
     slice/decode API as unconfirmed-at-design-time and requires a
     round-trip unit test (task 3.1) rather than assuming the surface —
     this is an honest, bounded uncertainty, not hand-waving (it doesn't
     affect config shape or row semantics either way).

2. **`PipelineProtocol.scala` split is behavior-preserving and lands both
   files under budget.**
   - Confirmed file is 257/258 lines pre-change (`wc -l` → 257;
     `node scripts/check-scala-quality.mjs` → 258, already flagged as a
     pre-existing soft-budget warning — the 1-line discrepancy is a
     trailing-newline artifact, immaterial).
   - Read the full file: the `AnalyzeStepResponse` sealed trait + 12
     per-kind case classes + `PipelineAnalyzeResponse` + the
     `analyzeStepResponseFormat`/`pipelineAnalyzeResponseFormat` implicits
     (lines 38-134, 177-228, ~150 lines) are cleanly extractable; what
     remains (CRUD + Run types/formats, ~110 lines + trait boilerplate)
     stays well under 250, and the new file (~150 lines + package/import/trait
     overhead) also stays well under 250.
   - Confirmed `com/helio/api/package.scala`'s aliases (lines 192-197)
     reference `protocols.AnalyzeStepResponse` / `protocols.PipelineAnalyzeResponse`
     by package path, not by file — so no alias edits are needed regardless
     of which file within `com.helio.api.protocols` defines the types.
   - Confirmed `JsonProtocols.scala`'s mix-in chain only names
     `PipelineProtocol` (not `PipelineStepProtocol` or any analyze-specific
     trait) — Scala trait linearization pulls in `PipelineAnalyzeProtocol`
     transitively once `PipelineProtocol extends ... with
     PipelineAnalyzeProtocol`, so `JsonProtocols` needs zero edits. Design's
     "no import-site changes needed" claim is correct.
   - Confirmed `check-scala-quality.mjs`'s file-size rule is soft
     (warn-only, does not fail commit/build) — ran it directly, 41
     pre-existing warnings across the codebase including
     `PipelineService.scala` (421 lines) and `PipelineStepRepository.scala`
     (257 lines), neither of which this design proposes to touch beyond
     adding one match arm each. This is correctly out of scope per the
     ticket's "Additional notes" (which named only `PipelineProtocol.scala`)
     and CLAUDE.md's "avoid unrelated refactors" rule — not a gap.

3. **All 8 backend enumeration sites cross-checked against actual file
   contents (mirroring HEL-220/`extractheadings`):**
   - `grep -rln "ExtractHeadings" backend/src/main/scala/` returned exactly:
     `PipelineProtocol.scala`, `PipelineStepConfigCodec.scala`,
     `PipelineStepProtocol.scala`, `domain/package.scala`,
     `PipelineAnalyzeService.scala`, `PipelineStep.scala`,
     `ExtractHeadingsStep.scala` (the step's own file, not an enumeration
     site), `PipelineStepRepository.scala`, `PipelineService.scala` — i.e.
     the same 8 sites design decision 9 lists (with `PipelineProtocol.scala`
     becoming `PipelineAnalyzeProtocol.scala` post-split). No missing site,
     no extra site invented.
   - Specifically confirmed the analyze-response wire path the ticket
     flags as previously missed: `PipelineService.scala:196-197`
     (`toAnalyzeStepResponse`'s `case Success(cfg: ExtractHeadingsConfig) =>
     ExtractHeadingsAnalyzeStepResponse(...)`) and
     `PipelineProtocol.scala`'s `analyzeStepResponseFormat` read/write match
     arms (lines 205/222) both exist today and are correctly named in task
     1.10 ("do not skip this site").
   - Confirmed all 7 named test files exist (`PipelineStepSpec.scala`,
     `PipelineStepConfigCodecSpec.scala`, `PipelineStepProtocolSpec.scala`,
     `InProcessPipelineEngineSpec.scala`, `PipelineAnalyzeServiceSpec.scala`,
     `PipelineStepRoutesSpec.scala` — actual path
     `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala`,
     not under `.../api/routes/`, a harmless path detail the design doesn't
     over-specify — `PipelineAnalyzeRoutesSpec.scala`), each already
     carrying `splittext`/`extractheadings` coverage in the same shape the
     new op's tests should mirror (verified via `grep` in each).

4. **Migration version and persistence spec.**
   - `ls backend/src/main/resources/db/migration/` confirms `V51` is the
     latest (`V51__add_extractheadings_op.sql`), no `V52` exists — `V52` is
     genuinely next-free.
   - Read `V51__add_extractheadings_op.sql` in full: the design's planned
     `V52` (drop/re-add `pipeline_steps_op_check` listing all 13 kinds)
     is a faithful copy of the established pattern.

5. **Frontend plan cross-checked against `SplitTextConfig.tsx`/
   `ExtractHeadingsConfig.tsx`, `stepNarrowing.ts`, `StepCard.tsx`,
   `useStepCardState.ts`, `pipelineStep.ts`.** Confirmed the
   `analyzeSchema.filter(f => f.type === "string-body")` gating pattern,
   the `Select`/`TextField` shared-component usage (including `LimitConfig.tsx`'s
   number-input precedent for `targetTokenCount`), and the
   type/union/wiring touch points design/tasks name all exist exactly as
   described — no invented APIs, no missing union members.

6. **Schema-inference plan (decision 5) matches `inferSplitText`/
   `inferExtractHeadings`'s actual validate-then-shape implementation**
   (read `PipelineAnalyzeService.scala:163-212` in full) — same
   unknown-field / non-string-body / success branches, same
   field-append-with-collision-replace semantics.

7. **Tasks ordering** — task 1.2 (file split + `sbt compile` check) is
   sequenced before task 1.3+ (new-op code), matching the design's own
   "confirm the split is behavior-preserving before adding any new-op
   code" directive. Task 3.10 includes the live `curl` check the ticket's
   AC explicitly requires ("Verify `GET /api/pipelines/:id/analyze`
   returns 200 ... via a live check").

### Verdict: CONFIRM

No placeholders, no internal contradictions between proposal/design/tasks,
no ambiguity a competent implementer could misread, no scope drift beyond
the ticket's ACs and its explicitly pre-authorized file split, and the
tasks fully cover every AC in the ticket (apply/infer parity, allowedOps
migration, StepCard UI, tokenization decision already escalated/resolved).
The design is sound to implement as written.

### Non-blocking notes

- Task list doesn't explicitly call out updating `PipelineAnalyzeServiceSpec.scala`
  by name in decision 9's "7 test files" prose (it says
  `PipelineAnalyzeServiceSpec` — confirmed correct), but worth the
  executor double-checking the exact literal-string test pattern used
  there (`"extractheadings — ..."` string-literal ops, not class-name
  references) so `grep`-based sanity checks during implementation don't
  give a false "missing" signal the way my first pass did.
- `PipelineService.scala` (421 lines) and `PipelineStepRepository.scala`
  (257 lines) are already over the soft budget independent of this
  change; out of scope here, but worth a future ticket if the trend
  continues.
