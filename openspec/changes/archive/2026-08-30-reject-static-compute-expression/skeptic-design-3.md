## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every claim below was re-derived from the code at base `82026d58`; the
round-1/round-2 reports were read only as claims to re-verify.

### What I verified (with evidence)

**Hook wiring and every line number in the artifacts.**
`grep -n validateRawConfig|requiredConfigProblems -r backend/src/main`: `PipelineService.scala:494`
(create), `:670` (update), `PipelineProposalService.scala:187`, `PatchSetApplyResolvers.scala:240`,
`PipelineAnalyzeService.scala:128` (shapeRejection) and `:141` (requiredConfigProblems),
`InProcessPipelineEngine.scala:145`. All five write/analyze sites and both run sites match the
design's table exactly. No sixth call site exists.

**Decision 4's corrected analyze mechanism (round 2's CR subject).**
`PipelineAnalyzeService.scala:128-132` reads `val shapeRejection = companion.flatMap(_.validateRawConfig(config)).toVector`
then `if (shapeRejection.nonEmpty) shapeRejection else { ...requiredConfigProblems... }`. Confirmed
short-circuit. Confirmed further at `:71-74` that `validateStepConfig`'s `Some(msg)` becomes the
step's `validationError` directly and suppresses `inferOutputSchema` — so analyze does report the
parse problem, with Decision 3's `"compute: invalid expression: "` prefix, exactly as design,
proposal and the runtime-completeness delta now all state.

**Round 2 CR 1 — runtime-completeness delta.** The paragraph now reads: run + preview evaluate via
`requiredConfigProblems`; analyze reaches it via write-path `validateRawConfig`, which
short-circuits; both carry the parser's description; "no requirement is placed on the prefixes being
identical." That is a true statement about the system the design plans. Fixed.

**Round 2 CR 2 — proposal.md.** The "Run path" bullet now says preview routes through the same
engine fold and that "Analyze reports the same defect by a different route — it evaluates
`validateRawConfig` first and short-circuits `requiredConfigProblems`". Matches design and both
deltas. Fixed. One mechanism is described in all four documents; I found no residual sentence
asserting the old one (grepped all artifacts for "same predicate"/"same override covers analyze").

**Round 2 non-blocking note adopted.** design.md Non-Goals now names `SourceService.applyComputedFields`
and `DataTypeService` (via `validateTolerant`), with `SourceService` flagged as a possible spinoff.

**Round 1 CR 1 — the tokenizer trace.** Re-derived independently from
`ExpressionEvaluator.scala:150-190`: `stats` hits the `l.isLetter` branch, which "intentionally does
NOT admit dots", emitting `Token.Ident("stats")`; the following `.` enters the digit/`.` branch,
`numStr = "."`, `toDoubleOption` is `None`; HEL-867's friendlier dotted-ref message is gated on
`buf.lastOption.exists(_.isInstanceOf[Token.Ref])` — the last token is an `Ident`, so it is skipped —
leaving `Left("Invalid number literal: .")`. `isDollarPrefixError` is `msg == DollarPrefixRequiredMsg`
(`:354`), false here, so `evaluate` (`:473-482`) never calls `parseLegacy`. `tokenize` is shared by
both parsers (`:346-352`), so the legacy grammar could not have accepted it either. design.md
Decision 1's paragraph now states precisely this. Task 1.2 still requires measuring it.

**Decision 1's regression argument.** `validate` (`:385`) is strict `parse` + `checkRefs`;
`StrictParser.parseFactor` returns `Left(DollarPrefixRequiredMsg)` on `Token.Ident` (`:281`). So a
legacy bare-identifier expression fails `validate` but evaluates fine — gating the write path on
`validate` would indeed 422 working pipelines. `parseProblem` as specified is `evaluate`'s parse arm
verbatim. Decision 1 is correct and is the load-bearing call it claims to be.

**Acceptance-criterion 2 plumbing.** `InProcessPipelineEngine:145` wraps non-empty
`requiredConfigProblems` in `IllegalArgumentException`; `StepExecutionException.from:32-35` allowlists
`IllegalArgumentException` and surfaces `getMessage` attributed to `stepId`/`stepKind`. Criterion 2
needs no new plumbing, as design claims.

**Preview claim.** `PipelineRunService.previewStep:230` → `engine.executeWithStepCounts` at `:268` —
the same fold that contains the `:145` gate. Preview genuinely inherits Decision 4's hook.

**Read-path hazard.** `ComputeConfig.decode` and the companion take `raw`/`configValue` only; nothing
in Decisions 3/4/6 lands on `rowToDomain`. Decision 5 + task 4.3 cover it.

**Empty-expression hazard.** `ComputeStep.companion.requiredConfigProblems` today is exactly
`StepCodecUtil.missingRequired(Kind, "column" -> ..., "expression" -> ...)`; Decision 4 preserves it
as the first branch, and Decision 3 short-circuits on `expression.trim.isEmpty`. Hazard 2 holds.

**AC coverage trace.** AC1 → D3 + tasks 2.1/2.2. AC2 → D4 + task 3.1. AC3 → D6 + task 4.1. AC4 → D3
short-circuit + tasks 2.4/3.4. AC5 → D5 + task 4.3. AC6 (measure materialised rows) → tasks 3.2 and
4.1, both explicitly on rows. No AC uncovered; no task outside the ACs.

**Evidence discipline in tasks.md.** Round 1's CR 4 relabelling held: 2.4, 2.5, 3.4, 3.5, 4.3 and 1.3
are all "Guard test" with the mutation that produces their red named; 2.1, 2.2, 3.1, 3.2, 4.1 are
"Proof test (red first)" with the current-`main` green behaviour they must first contradict spelled
out. 5.2 forbids adopting any asserted count. Task 4.2 carries the correct conditional: if the
AST-level entry point is dropped, the "parsed once per step evaluation" SHALL must be deleted from
the `pipeline-compute-op` delta in the same commit — otherwise the change would ship an unmet SHALL.

**Delta hygiene.** `npx openspec validate reject-static-compute-expression --strict` → valid. The
`pipeline-compute-op` MODIFIED requirement header matches the shipped one at
`openspec/specs/pipeline-compute-op/spec.md:8`, and all eight pre-existing scenarios are carried
forward. Both ADDED requirements target existing capabilities and do not collide with existing
requirement names. The shipped "The same incompleteness SHALL be reported at analyze time"
requirement is scoped to missing-or-empty config, so the new two-route requirement does not
contradict it.

### Verdict: CONFIRM

The proposal, design and all three deltas now describe one consistent mechanism; the two
surviving round-2 contradictions are genuinely fixed, not paraphrased; the Decision 1 trace matches
the tokenizer; every acceptance criterion traces to a decision and at least one task; the
proof/guard split is enforced task-by-task with a named red for each. Sound enough to implement.

### Non-blocking notes

- **Analyze's `outputSchema` changes shape for a bad-expression step.** Because
  `validateStepConfig` returning `Some` suppresses `inferOutputSchema` (`PipelineAnalyzeService:71-74`),
  a step that today reports `inferCompute`'s validation message *with the computed column appended*
  (`:302`) will after Decision 3 report the write-path message with `outputSchema == inputSchema`.
  That matches the shipped identity-fallback contract and the existing empty-column scenario, so it
  is not a defect — but a one-line `AND that step's output schema equals its input schema` on the
  "Analyze reports the same problem" scenario would pin it deliberately rather than leave it to be
  discovered at test time.
- The `pipeline-compute-op` MODIFIED body drops HEL-814's third paragraph ("This narrows the
  unconditional ... indistinguishable from success"). Its normative sentence is retained, so nothing
  is lost requirement-wise, but a MODIFIED block replaces the whole requirement and that rationale
  will not survive the archive. Consider restoring it.
- Task 1.2 is labelled "Proof test" but its red is a compile failure (`parseProblem` does not exist
  yet), not the defect failing. It is really a characterization measurement of the Decision 1 trace.
  Task 5.2 asks how each red was produced, so this will surface honestly — just don't let it inflate
  the proof count.
