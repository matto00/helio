## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Owner rulings not re-litigated, and faithfully implemented.** `ticket.md` records the two rulings
  verbatim (restated AC1: string-body column + analyze parity, no markdown-Output work; per-row shape, no
  collapse, no mode toggle). `workflow-state.md`'s `CONSTRAINTS` (C2/C3) and `tasks.md`'s Standing
  Constraints mirror them exactly, and `design.md` D1/D7 justify them on the accepted grounds (consistency
  with the non-aggregate step population; cost legibility) rather than re-arguing scope. No re-litigation
  found.

- **D8 (CHECK-constraint drop) — both halves verified independently, not taken on trust.**
  - `backend/src/main/resources/db/migration/V107__add_writeback_ops.sql:18-19` — read the actual CHECK
    constraint: it admits exactly 27 op strings, the last being `generatetext`. Registering `generatetext`
    does leave zero V107-legal-but-unregistered op names, exactly as D8 claims — a probe using any real op
    name would hit a registered step, not the unregistered-op 500 path.
  - `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:51-52,665-674` —
    confirmed the suite starts its own `EmbeddedPostgres` in `beforeAll` (not the shared dev DB), and that
    the currently-live probe at line 665 still manually inserts a `'generatetext'` row as the "unregistered
    op" case — i.e. this probe is currently broken by this very ticket and D8's fix is not hypothetical.
  - Precedent check: `V98PipelineRootsMigrationSpec.scala:386` and
    `PipelineStepsOpCheckOwnershipRequiredSpec.scala` (both read) do exactly the pattern D8 proposes — drop
    a constraint inside their own embedded Postgres before exercising the now-permitted path. D8's citation
    is accurate, not invented.

- **D9 (six registry-enumerating surfaces) — checked for completeness by grepping the whole backend test
  tree for anything else that hardcodes registry size or enumerates `PipelineStepKind.All`/kind sets,**
  rather than trusting the design doc's own list:
  - `grep -rln "Registry should have size 26\|PipelineStepKind.All\|..."` surfaced exactly the files D9
    names, plus three false positives that don't need edits (`UpsertSourceStepSpec` — a `contain(...)`
    check unaffected by additions; `PipelineCycleDetectionServiceSpec` — comments only, no assertion; and
    a size-26 grep hit already covered by D9's `PipelineStepRequiredConfigSpec` file).
  - One real gap found: `PipelineStepRepositorySpec.scala:100-110` also iterates
    `PipelineStepKind.All.toSeq.sorted`, inserts `config='{}'` for every kind including the new one, and
    asserts decode doesn't throw and `steps.map(_.kind).toSet shouldBe PipelineStepKind.All`. This is
    structurally identical to the `PipelineStepConfigCodecSpec` case D9 does name, and D9's list omits it.
    However, verified it will **not** actually go red: because D2 requires `GenerateTextConfig.decode` to be
    tolerant of `"{}"` (every key defaults to `""`), this repository-level test passes automatically once
    that tolerant decode exists, with no code change specific to this file, exactly like the
    `PipelineStepConfigCodecSpec` case D9 does call out. So this is an incompleteness in the design doc's
    inventory, not a build risk — non-blocking.

- **D3 (no response schema) sanity-checked against `AnalyzeWithAiStep.scala` (read in full) and
  `AiStepClient.scala` (read in full).** `analyzewithai`'s schema enforcement exists because its config
  declares a typed, multi-field `outputSchema` that the model's JSON response must exactly match — there is
  a real contract to enforce. `generatetext` has no analogous declared shape: the single output is always
  the model's raw text, which is unconditionally a `String` by the `AiStepClient` interface
  (`Future[Either[AiStepFailure, String]]`) — there is no "wrong type" or "missing/extra key" failure mode
  possible for a single free-text field. The one real risk unique to this step (silently writing a blank
  cell that looks like real data) is exactly what `response-empty` guards. Verdict: D3 does not drop a
  guarantee `analyzewithai`'s precedent implies — the guarantee doesn't apply here because there is nothing
  to validate against.

- **D2 (`outputField` required, not defaulted to `inputField`) checked against `ConvertFormatStep.scala`.**
  `outputField` deviation was verified in the actual `ConvertFormatStep.scala` source
  (`row + (cfg.outputField -> converted)`, config default elsewhere in that file), confirming the described
  precedent (`ConvertFormatConfig.outputField` defaults to `field`) is real, and the asymmetry (lossless
  format conversion vs. destructive silent-overwrite-of-source-content risk for a generator) is a sound,
  non-arbitrary reason to diverge.

- **Auto-run denial precedent (spec's "never auto-runnable" requirement) confirmed already in place**:
  `PipelineCostEstimator.scala:24` — `AiOps: Set[String] = Set("analyzewithai", "generatetext")`, checked
  before the general allowlist at line 111-112 — matches the spec scenario and design's claim that no
  `AiOps` change is needed.

- **`openspec validate generatetext-pipeline-step --type change` re-run independently**: exits 0, "Change
  'generatetext-pipeline-step' is valid" — matches the claim in the task description.

- **Internal consistency**: proposal.md / design.md / tasks.md / spec.md agree on config shape
  (`{inputField, instruction, outputField}`), reason codes (six, exact names match across design.md D4,
  tasks.md 1.3/3.3-3.5, and spec.md's Requirement 5), and analyze behavior (D6 / task 2.4 / task 4.1 /
  spec.md Requirement 6) — no contradiction found between artifacts.

- **No placeholders/TODOs/hand-waving** found in any of the five artifacts. Every task in `tasks.md` names a
  concrete file/behavior and a verification step; C5's "prove failable by mutation" requirement is carried
  through into task 5.1.

### Verdict: CONFIRM

### Non-blocking notes

1. `design.md` D9's "six registry-enumerating surfaces" list should also name
   `PipelineStepRepositorySpec.scala`'s "decode rows for every step kind... without throwing" test
   (`:100-110`) as a seventh surface that exercises the registry via `PipelineStepKind.All`, even though it
   requires no edit (it is satisfied automatically by D2's tolerant-decode requirement, exactly like the
   `PipelineStepConfigCodecSpec` case already called out). Purely a documentation completeness note — it
   does not change the plan or create a build risk; I verified independently that this test will pass
   without modification once tolerant decode is implemented as designed.
