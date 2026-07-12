## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/pipeline-split-text-op/spec.md`, `specs/pipeline-steps-persistence/spec.md`) in full.
- Read `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — confirmed the Registry has
  exactly 10 entries today, and confirmed the trait's own doc comment states it is **deliberately
  NOT `sealed`** ("Scala 2 constrains sealed-trait subclasses to the same compilation unit, which
  would defeat the per-file refactor... The trait is intentionally NOT sealed").
- Read `backend/build.sbt` in full — confirmed there is **no `scalacOptions` entry at all**, in
  particular no `-Xfatal-warnings` / `-Wconf` / `-Werror`.
- Read `PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`,
  `PipelineStepRepository.scala` (`rowToDomain`) — confirmed the actual match-site count/shape
  design.md decision 8 claims (fromDomain / write / read in Protocol = 3 arms; extractConfig /
  encodeConfig in Codec = 2 arms; rowToDomain = 1 arm; Registry = 1 entry).
- Read `PipelineAnalyzeService.scala` in full — confirmed `inferCompute`'s validate-then-shape
  pattern and the `SchemaField(name, type)` shape design.md decision 5 says `inferSplitText` should
  mirror; confirmed the dispatch switch (`inferOutputSchema`) is a plain `match` that a new
  `"splittext"` case slots into cleanly.
- Read `backend/src/main/scala/com/helio/domain/model.scala` — confirmed `StringBodyType` encodes
  to wire string `"string-body"`, matching design.md/spec.md's field-type comparison.
- Read `backend/src/main/resources/db/migration/` (`ls ... | sort -V | tail -5`) — confirmed
  `V49__add_image_source_type.sql` is the current max; `V50` is free.
- Read `V31__add_aggregate_op.sql` — confirmed the drop/re-add CHECK-constraint template design.md
  decision 7 cites.
- Read `frontend/src/features/pipelines/ui/FilterConfig.tsx`, `CastFieldsConfig.tsx`,
  `state/stepNarrowing.ts`, `types/pipelineStep.ts`, `ui/StepCard.tsx`,
  `hooks/useStepCardState.ts` — confirmed the `analyzeSchema: SchemaField[]`-driven pattern
  (Filter/Aggregate) vs. `analyzeColumns: string[]`-driven pattern (Cast/Select/Rename) design.md
  decision 6 distinguishes, and confirmed `StepCard` already threads `analyzeSchema` through, so the
  frontend wiring plan (tasks 2.1–2.4) is mechanically sound.
- Read `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — confirmed its
  exhaustiveness test is a hand-curated `allSubtypes: Seq[PipelineStep]` list (task 3.3 correctly
  targets it).
- **Read the two other existing per-kind test files that are NOT mentioned anywhere in
  design.md/tasks.md**:
  - `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` (lines
    153–172): `"encode" should "round-trip through encodeConfig for every typed config"` iterates a
    **hand-curated `cases: Seq[(String, Any)]`** (10 entries, one per kind) — not derived from
    `PipelineStepKind.All`.
  - `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` (lines 17–28):
    `subtypes: Seq[PipelineStepResponse]` — also **hand-curated**, drives the write/read/round-trip
    assertions that exercise exactly the `fromDomain` + write/read-union match arms design.md
    decision 8 calls out.
  - `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` (lines 280–292): the
    established precedent for a newly-added op is a dedicated route-level test —
    `"POST with type 'aggregate' is accepted (regression: AllowedOps drift)"`.
  - `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` (lines 30–42): cast
    and groupby step-level behavior tests actually live **inside this file**, via a hand-curated
    `makeStep(kind, config)` helper with its own `case c: XConfig => XStep(...)` match — there is
    **no separate `CastStepSpec.scala` / `GroupByStepSpec.scala`** for tasks.md 1.1/3.1 to "mirror."

### Verdict: REFUTE

### Change Requests

1. **design.md decision 8's "compile error" safety-net claim is factually wrong — correct it.**
   Decision 8 states "Missing any one is a compile error (sealed-ish exhaustive match) except the
   CHECK constraint and the `PipelineStepSpec`... test, which fail at migration/test-run time
   instead." This is false for every site listed except the CHECK constraint:
   - `PipelineStep` is explicitly documented as **not sealed** (`PipelineStep.scala` lines 26–29),
     so `fromDomain`, `extractConfig`, and `rowToDomain`'s `case s: X =>` matches over `PipelineStep`
     cannot be exhaustiveness-checked by scalac at all — a missing arm compiles silently.
   - `rowToDomain` and `encodeConfig` pattern-match on `Any` (`case Success(cfg: X)` / `case c: X`),
     which is never exhaustiveness-checked regardless of sealedness.
   - Even the one genuinely sealed match (`PipelineStepResponse` read/write union, same file) would
     at most produce a scalac *warning*, not a build failure — `build.sbt` has no `scalacOptions`
     entry, in particular no `-Xfatal-warnings`.
   Revise decision 8 to state plainly: **every one of these 6 sites fails silently at compile time
   and only surfaces as a runtime `MatchError` (or `IllegalStateException`, per the existing
   catch-all arms) if and only if a test happens to exercise that exact code path with a
   `SplitTextStep`/`SplitTextConfig` value.** This materially raises the importance of Change
   Requests 2–3 below — the test suite, not the compiler, is the only safety net.

2. **Add tasks to update the two hand-curated per-kind test lists that are the actual safety net
   for the sites in decision 8, currently absent from tasks.md's Tests section:**
   - `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala`: add a
     `"splittext" -> SplitTextConfig(...)` entry to the `cases` list in the `"round-trip through
     encodeConfig for every typed config"` test (~line 155–166). Without this, the new
     `extractConfig`/`encodeConfig` arms (task 1.5) are never exercised by any existing test.
   - `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala`: add a
     `SplitTextStepResponse(...)` entry to the `subtypes` list (~line 17–28). Without this, the new
     `fromDomain`/write/read arms (task 1.4) are never exercised by the existing round-trip test.

3. **Add a route-level integration test to `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala`**
   mirroring the existing `"POST with type 'aggregate' is accepted (regression: AllowedOps drift)"`
   test (lines 280–292) — e.g. `"POST with type 'splittext' is accepted"`. This is not optional
   polish: it is the literal scenario the change's own spec delta requires
   (`specs/pipeline-steps-persistence/spec.md` lines 33–36, "POST with type 'splittext' is
   accepted") and currently has no corresponding task anywhere in tasks.md. This single test is
   also the one most likely to catch a missed arm across the full request→repository→response
   round trip in one shot.

4. **Correct the "mirror CastStep/GroupByStep's existing spec structure" instruction in tasks.md
   1.1 and 3.1 — no such per-step spec files exist.** `CastStep`/`GroupByStep` have no dedicated
   spec file; their behavior is tested inside `InProcessPipelineEngineSpec.scala` via a hand-curated
   `makeStep(kind, config)` helper (lines 30–42) that itself needs a
   `case c: SplitTextConfig => SplitTextStep(...)` arm to construct a `SplitTextStep` through that
   helper. Either (a) explicitly decide `SplitTextStep` gets a **new, standalone**
   `SplitTextStepSpec.scala` (a fine and arguably cleaner choice for HEL-220/221 to copy — but say
   so explicitly, since it establishes a new precedent rather than mirroring an existing one), or
   (b) if engine-level coverage via `InProcessPipelineEngineSpec.scala` is wanted too, add a task to
   extend that file's `makeStep` helper. Leaving this ambiguous is exactly the kind of
   under-specification the ticket asks this design to avoid, since HEL-220/HEL-221 will copy
   whatever precedent is (or isn't) set here.

### Non-blocking notes

- Decision 3 (row-semantics) specifies "last write wins" for `indexField`/schema-name collisions
  only in decision 5 (schema inference). It would be worth one sentence in decision 3 confirming
  the same last-write-wins order applies at the row level if a user sets `indexField` equal to
  `field` itself (i.e., which value survives on the output row) — low risk, but worth being
  explicit given HEL-220/221 will copy this section verbatim.
- `PipelineAnalyzeService`'s `inferOutputSchema` dispatch (lines 63–72) doesn't handle `"join"` or
  `"groupby"` at all (both fall through to the generic `"Unknown op"` branch) — pre-existing gap,
  unrelated to this change, not something HEL-219 needs to fix, but worth knowing it's not a
  complete precedent to lean on beyond the `inferCompute` shape you already cited correctly.
