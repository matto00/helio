## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-assert-op/spec.md`. No `TODO`/`TBD`/hand-waving found; the six v1 rule
  kinds, field-requiring-vs-dataset-level split, decode-tolerance rules, and analyze
  dispatch shape are all concretely specified and consistent across ticket / proposal /
  design / spec.
- Cross-checked every acceptance criterion in `ticket.md` against `tasks.md` — all six ACs
  trace to at least one task (persistence/round-trip → 1.1-1.4, 2.1-2.3, 6.1; migration →
  3.1-3.2; analyze identity + validationError → 3.3, 6.3; decode tolerance → 1.1, 6.2;
  editor → 5.1-5.4, 6.5; test suites → 6.4/6.6).
- Verified the design's central factual claims against the actual codebase, not just the
  narrative:
  - `FilterConfig.decode`'s tolerant-decode precedent (`backend/src/main/scala/com/helio/domain/steps/FilterStep.scala:24-38`) matches design.md Decision 2's description exactly (`Try(...).toOption` per array item, `StepCodecUtil.stringOr` for scalar defaults).
  - `PipelineAnalyzeService.scala:73` confirms the identity-dispatch group (`filter|limit|sort|dedupe|fillnull|union`) and that `pivot`/`unpivot` (lines 83/85) get dedicated cases — validating design.md Decision 5's dispatch-shape reasoning.
  - `inferUnpivot`/`inferPivot` (lines 306-401) confirm the "aggregate all problems into one `validationError`, never short-circuit" precedent Decision 5 cites.
  - `PipelineStep.scala`'s `Registry`/`PipelineStepKind` (lines 100-174) confirm the registry-derived `All` set and the parity-test safety net design.md's Context section describes.
  - The migration-number discrepancy between `ticket.md` ("main at V59") and `design.md` Decision 7 ("main at V81") is real — I confirmed the actual repo state (`ls backend/src/main/resources/db/migration/` → highest is `V81__agent_preferences.sql`) matches design.md's V81, not the stale ticket text. This is explicitly and correctly handled: Decision 7 instructs the executor to re-check immediately before writing the migration rather than trust either snapshot, and task 3.1 encodes that instruction. Not a defect.
  - Verified `PatchSetApplyResolvers.scala`'s `validateEmbeddedStepReferences` (lines 234-263) has a catch-all `case Success(_) => Future.successful(Right(()))` for any config not `Join`/`Union`/`Lookup` — confirming design.md's correct omission of this file from assert's touch points (assert has no second-DataSource reference, so no new match arm is needed there).
- Traced every file that references `LookupStep`/`LookupConfig` (the most-recently-added op, used as the precedent throughout design.md) via `grep -rl "LookupStep\|LookupConfig" backend/src/main/scala frontend/src/features/pipelines`, then checked each one against proposal.md's Impact list / design.md's Context touch-point enumeration / tasks.md's task list. All matched **except one** — see Change Request 1 below.

### Verdict: REFUTE

### Change Requests

1. **Missing touch point: `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala`.**
   Design.md's Context section claims the touch-point list was "confirmed by grepping every
   `LookupStep`/`LookupConfig` reference" and enumerates 9 files; tasks.md's task 3.4 says only
   "`services/PipelineService.scala`: add `AssertAnalyzeStepResponse` wiring in the analyze
   response assembly (mirror `LookupAnalyzeStepResponse`)." Neither mentions
   `PipelineAnalyzeProtocol.scala` — but that is where `LookupAnalyzeStepResponse` (and every
   sibling `*AnalyzeStepResponse`) is actually **defined**:
   - The case class itself: `PipelineAnalyzeProtocol.scala:175-179` (`final case class LookupAnalyzeStepResponse(...) extends AnalyzeStepResponse`).
   - Its `jsonFormat6` instance: `PipelineAnalyzeProtocol.scala:224`.
   - Its arm in the sealed `analyzeStepResponseFormat.write` dispatch: `PipelineAnalyzeProtocol.scala:250`.
   - Its arm in the sibling `.read` dispatch (by `type` discriminator): the same object, ~line 270s (pattern continues past what I've quoted, same shape as the other `PipelineStepKind.*` cases at lines 256-270).

   `PipelineService.scala:405`'s `case Success(cfg: LookupConfig) => LookupAnalyzeStepResponse(...)`
   only *constructs* an already-defined response type — it is not where that type is declared.
   Because `AnalyzeStepResponse` is a `sealed trait`, if `AssertAnalyzeStepResponse` is defined
   somewhere that never joins its `write`/`read` dispatch (e.g. mistakenly inlined inside
   `PipelineService.scala` instead), the analyze endpoint will compile but throw a `MatchError`
   at runtime the first time an assert step's analyze response is serialized — a direct
   regression against AC3 ("`analyze_pipeline` returns identity output schema for an assert
   step"). This is exactly the class of gap the design's own risk section (task-touch-point
   count "confirmed by grepping") claims to have foreclosed, and demonstrably has not.

   **Required revision:** update `design.md`'s Context touch-point list and `proposal.md`'s
   Impact section to include `api/protocols/PipelineAnalyzeProtocol.scala`, and split/clarify
   `tasks.md` task 3.4 into two explicit steps: (a) define `AssertAnalyzeStepResponse` + its
   `jsonFormat6` + its `write`/`read` dispatch arms in `PipelineAnalyzeProtocol.scala` (mirroring
   `LookupAnalyzeStepResponse` exactly, including the `PipelineStepKind.Assert` `type` case), and
   (b) wire the `case Success(cfg: AssertConfig) => AssertAnalyzeStepResponse(...)` construction
   arm in `PipelineService.scala:toAnalyzeStepResponse`, as currently written.

### Non-blocking notes

- `proposal.md`'s Impact wording "wired into `StepCard.tsx`, `OpDropdown.tsx`'s `OP_TYPES`" is
  imprecise — `OP_TYPES` is actually defined in `frontend/src/features/pipelines/state/stepNarrowing.ts`
  (`OpDropdown.tsx` only imports and renders it). `tasks.md` task 5.2 already targets the correct
  file, so this is cosmetic only in the proposal's prose, not a planning defect.
- The `AssertConfig.tsx` editor task (5.1) leaves the exact per-kind `params` input widget shapes
  (e.g. numeric fields for `range.min`/`max` vs. a text field for `regex.pattern`) to implementer
  discretion. This matches the level of detail every other per-kind config editor in this codebase
  (`WindowConfig.tsx`, `StringOpsConfig.tsx`) was scoped at, so it's not a blocking ambiguity —
  flagging only so the evaluator/skeptic at the final gate knows to check the editor actually
  renders sensible per-kind param controls rather than a single freeform JSON textarea.
