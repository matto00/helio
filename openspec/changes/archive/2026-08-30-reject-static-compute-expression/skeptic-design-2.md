## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Decision 1's revised tokenizer mechanism — verified correct, independently.**
  `ExpressionEvaluator.scala:173-188`: the bare-identifier scan admits no dots, so
  `stats` emits `Token.Ident("stats")`. The following `.` enters the number branch
  (`:151-172`): the scan consumes digits/dots only, so `numStr == "."`,
  `toDoubleOption` is `None`. HEL-867's friendlier dotted-ref message (`:165-168`)
  is gated on `numStr.startsWith(".") && buf.lastOption.exists(_.isInstanceOf[Token.Ref])`
  — the last token is `Token.Ident`, so it is skipped and the branch returns
  `Left("Invalid number literal: .")`. `isDollarPrefixError` is exact string equality
  against `DollarPrefixRequiredMsg` (`:81`, `:354`), so it is false, and `evaluate`
  (`:473-482`) falls to `Left(ParseError(msg))` without calling `parseLegacy`.
  `parse` and `parseLegacy` (`:346-352`) both call the one shared `tokenize`, so the
  legacy grammar could not have accepted it either. Design's paragraph matches the code.
- **Call-site enumeration re-derived from the tree, not from the artifacts.**
  `grep -rn validateRawConfig backend/src/main/scala` → exactly five call sites:
  `PipelineService:494`, `PipelineService:670`, `PipelineProposalService:187`,
  `PatchSetApplyResolvers:240`, `PipelineAnalyzeService:128`. `requiredConfigProblems`
  → `InProcessPipelineEngine:145` (via the `:173` helper) and
  `PipelineAnalyzeService:141`. The design's hook table is now complete and correct.
  Default `validateRawConfig` = `strictDecodeProblem(raw)` (`PipelineStep.scala:130`),
  so Decision 3's `super…orElse` composes as described.
- **Analyze short-circuit confirmed.** `PipelineAnalyzeService:128-132`:
  `if (shapeRejection.nonEmpty) shapeRejection else { …requiredConfigProblems… }`.
  Once Decision 3 lands, analyze reports the parse problem via the write-path string
  and never reaches `requiredConfigProblems`. Design Decision 4 and tasks 3.5 now
  state this correctly.
- **Run-path attribution confirmed.** `InProcessPipelineEngine:145-150` throws
  `IllegalArgumentException(problems.mkString("; "))`, recovered into
  `StepExecutionException.from(step.id.value, step.kind, ex)` at `:158-161` — AC2's
  "step id, type, parse error" shape holds with no new plumbing. The engine evaluates
  `requiredConfigProblems` over `encodeConfig(step.configValue)` (`:173`); `ComputeConfig`
  round-trips `expression` verbatim, so the predicate sees the stored expression.
- **Config-less update risk verified.** `PipelineService:655-670`: `req.config match { case None => updateInternal(...) }` runs no `validateRawConfig`. The new Risks entry is accurate.
- **Current `ComputeStep` state confirmed** — no `validateRawConfig` override today; `apply` calls `evaluate` per row with `case Left(_) => null`. So tasks 2.1/2.2/3.1/3.2 will genuinely be red on `main`.
- **Task relabelling (2.4, 2.5, 3.4, 4.3 → Guard) and task 4.2's spec-deletion note verified present** in tasks.md.
- **AC coverage traced:** AC1→2.1/2.2; AC2→3.1; AC3→4.1; AC4→2.4 (save) + 3.4 (run); AC5→4.3; AC6 (measure materialised rows)→3.2/4.1. No AC uncovered.

### Verdict: REFUTE

One genuine, blocking internal contradiction survives round 1: Decision 4 was corrected
in `design.md`, but the two prose artifacts that assert the *old* mechanism were not
updated with it. One of them is a normative SHALL in a spec delta that the planned
implementation provably cannot satisfy.

### Change Requests

1. **`specs/pipeline-step-config-runtime-completeness/spec.md` states a SHALL the
   implementation will not meet.** The requirement body says: "The check SHALL be
   evaluated through the step kind's `requiredConfigProblems`, the same predicate over
   the same raw configuration that the analyze surface evaluates, so the run and analyze
   surfaces cannot disagree." Per design Decision 4 (which I verified against
   `PipelineAnalyzeService:128-132`), the **analyze surface never evaluates
   `requiredConfigProblems` for this defect** — `shapeRejection` short-circuits and the
   problem arrives from `validateRawConfig` with a different message prefix. As written
   the delta archives a false statement about the shipped system and contradicts the
   design in the same change. Rewrite that paragraph to say the run and preview surfaces
   evaluate the check through `requiredConfigProblems`, while the analyze surface reports
   the same defect through the write-path `validateRawConfig` rejection (which
   short-circuits `requiredConfigProblems`), and that both messages carry the parser's own
   description though their prefixes differ. Keep the "Analyze reports the same problem"
   scenario — it is satisfiable as a substring assertion.

2. **`proposal.md` carries the same stale claim.** Under "Run path": "The same override
   covers analyze and step preview, which route through the same predicate." Analyze does
   not route through that predicate for this case. Correct it to match the revised
   Decision 4 (preview via `requiredConfigProblems`; analyze via the write-path override),
   so the proposal, design, and spec delta all describe one mechanism.

### Non-blocking notes

- `ExpressionEvaluator.evaluate` has two other callers outside this change's scope —
  `SourceService.applyComputedFields` and `DataTypeService` (via `validateTolerant`).
  The DataType path hard-blocks on validation, but `SourceService`'s computed-field path
  is worth a glance for the same discard-the-`Left` shape; if it has it, that is a
  spinoff ticket, not scope creep here. The Non-Goals section could name it explicitly.
- Task 5.3 already requires re-reading the prose against the final code; CRs 1 and 2 are
  exactly the class of drift it exists to catch, but they should be fixed now rather than
  deferred, since the spec delta is what gets archived.
