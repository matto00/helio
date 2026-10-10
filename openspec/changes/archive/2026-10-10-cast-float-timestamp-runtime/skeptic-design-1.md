## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 719710c15d457de02bcb681192275f2f011268dc (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Runtime fallthrough is real.** `backend/src/main/scala/com/helio/domain/steps/CastStep.scala` `castValue`: `case "date" => str`, `case _ => str`. `float`/`number`/`timestamp` all hit the fallthrough. Confirmed.
- **The write validator accepts any target string.** `CastStep.companion.validateRawConfig` checks only the shape (`requireStringMap`), then `strictDecodeProblem`. Confirmed.
- **Every cast write path goes through `validateRawConfig`.** `PipelineStep.rawConfigProblem` (PipelineStep.scala:283) is called from PipelineService.scala:562 (single-call create), :1858 (step create), :2212 (step update with config), PipelineProposalService.scala:295 (proposal apply, which first-run/persona also use via `PipelineProposal`), and PatchSetApplyResolvers.scala:204/576/737 (assistant/MCP patch-sets). The remaining repo writes are step duplicate (PipelineService.scala:2414, copies a stored config), position/enabled-only update (:2200), and patch-set undo. None of these accepts a new caller-supplied target. The inventory claim holds.
- **Analyze inference.** `ColumnSchemaInference.inferCast` → `DataFieldType.canonicalizeLegacy` (model.scala:449): number/double→float, long→integer, date→timestamp. An unrecognised value goes to `SchemaField`'s `require` and throws. Confirmed.
- **Manual run path is not gated by `validateRawConfig`.** `InProcessPipelineEngine` (lines 269, 506) gates only on `requiredConfigProblems`. D4's claim is correct for manual runs.
- **Auto-run AND scheduled runs ARE gated by `validateRawConfig`.** `RunConfigGate.stepConfigReasons` → `PipelineAnalyzeService.stepConfigProblem` → `StepConfigValidation.validateStepConfig`, which calls `companion.validateRawConfig` first (StepConfigValidation.scala:49). `RunConfigGate` has two callers: `AutoRunTriggerService.scala:107` and `PipelineSchedulerService.scala:205`. The second, `gatedSubmit`, records a failed "not attempted" run and never executes. D4 mentions only auto-run.
- **The UI picker** (`CastFieldsConfig.tsx:8`) offers string, integer, long, double, boolean. First-run (`FirstRunPlanner.scala:36`) emits `double`. The assistant schemas show only an `integer` example. Confirmed.
- **The HEL-1403 trust set** (`AnalyzeSchemaWarnings.scala:69`) matches the design's table. `castTrusted` runs only when the step has no `validationError` (line 134).
- **Claim: every timestamp producer emits a String.** True: JSON/REST strings via `PipelineRowJson.jsValueToAny`, `datebucket` `LocalDate.toString`, and dataset rows validated as JsString. **But the attribution to CSV is false.** `SchemaInferenceEngine.fromCsvLines` (lines 54-58, HEL-893 D1) declares every CSV column `StringType` and never calls the timestamp predicate. `TimestampParsing.looksLikeTimestamp` is used only by JSON/REST/SQL inference (`inferJsonType`, line 226) and `DatasetRowValidator` (line 73).
- **A second, wider "timestamp" definition already exists.** `DateBucketStep.parseToUtcDate` / `parseNonEpochDate` (DateBucketStep.scala:158-180) accepts space-separated `2026-07-01 12:00:00`, optional fractional seconds, and epoch seconds or millis. The first-run date-like column test reuses it (HEL-1209). `looksLikeTimestamp` rejects `2026-07-01 12:00:00`, because ISO_LOCAL_DATE_TIME needs a `T`.

### Verdict: REFUTE

### Change Requests

1. **D4 contradicts owner ruling 2 for scheduled and auto-run pipelines, and misstates its own blast radius.** Ruling 2 says stored legacy targets "get an explicit, tested runtime passthrough". Under D4, a stored `string-body`/`binary-ref`/unknown cast fails `RunConfigGate`. Its auto-runs are skipped, and every scheduled fire becomes a recorded failed "Step configuration invalid; scheduled run not attempted" run (`PipelineSchedulerService.gatedSubmit`). So the passthrough is reachable only by a manual click, and a scheduled pipeline that refreshes today silently stops refreshing. The ruling did not ask for that. It also breaks `RunConfigGate`'s own contract (AutoRunTriggerService.scala:102-106: it gates "a run certain to fail"). Under D5 this run succeeds. The HEL-1310/1416 precedent D4 cites covers enum values the runtime rejects, so it does not carry over. Revise D4 to one of these:
   - (a) **Preferred.** Keep the unsupported-target rejection out of the analyze and run-gate path. Reject at write only, either with a cast-specific write-time check at the `rawConfigProblem` sites or with a flag that `StepConfigValidation` does not consult. Make analyze project the **input field's type unchanged** for a legacy target, which is exactly what D5's runtime passthrough produces. That gives no analyze/run disagreement (the reason D4's alternative was rejected), no gating, and no `SchemaField` `require` throw for unknown strings.
   - (b) If the planner believes gating is right, raise an `ESCALATION`. Gating scheduled runs of stored pipelines is a decision outside the ruling as written. Do not decide it unilaterally.
   Either way, fix the D4 text and the Risks section: they must name the scheduler gate, not just auto-run.

2. **D3's timestamp predicate rests on a false premise, and as designed it would null data that works today.** The design and spec ground the predicate in "the same formats CSV schema inference recognises as a timestamp" and justify "no trim" and "epoch → null" by CSV parity. CSV recognises no timestamps (HEL-893). The cast would also be stricter than `datebucket`, the main downstream consumer of a timestamp column. Example: an existing `cast {"when":"date"}` → `datebucket` chain over `2026-07-01 12:00:00` (a common SQL/export shape) buckets correctly today and would become all-null after this change. Ruling 1 fixes null-on-unparseable but does not fix which predicate defines "parses". Required:
   - Re-derive the predicate against the codebase's real producers and consumers (`TimestampParsing.looksLikeTimestamp` and `DateBucketStep.parseNonEpochDate`).
   - Pick one and justify it with true facts. My recommendation: at minimum accept everything `parseNonEpochDate` accepts, so no cast→datebucket chain regresses.
   - Decide epoch numbers explicitly against datebucket's behaviour, not CSV's.
   - Correct every CSV reference in design.md (Context paragraph, D3), the spec delta ("the same formats CSV schema inference recognises" / "a CSV column inferred as `timestamp`"), and proposal.md ("the representation CSV timestamp inference … already emit").
   - Add `"2026-07-01 12:00:00"` (and the epoch decision) to task 1.1 and to the D7 parity assertion.

3. **Task 1.7 must test whatever D4 becomes, on every trigger path.** If revised per CR1(a), add assertions that a stored legacy-target cast:
   - produces no `step-config-invalid` reason from `RunConfigGate.stepConfigReasons`, so it is neither auto-run-gated nor schedule-gated;
   - gets an analyze projection that equals its input type.
   If gating survives through an escalation, test the scheduled path explicitly. Today 1.7 only says "record whether manual run is gated". That is already answered (it is not, InProcessPipelineEngine.scala:269), so the open question is the scheduler and auto-run.

### Non-blocking notes

- **D5 (`case _ => v`).** Passing the original value through is the more literal reading of "passthrough" and I accept it. It does change stored behaviour: a non-string under a legacy target used to come out as `toString`. The PR body should say so alongside the `date` null change.
- **Spec scope.** The spec says rejection also applies "through … an applied proposal". Task 1.5 tests only step create and single-call create. The shared `rawConfigProblem` makes this low-risk, but one PatchSet/proposal-apply assertion would close it.
- **Exposure count.** The dev exposure count covers date/timestamp/float but not the legacy targets (`string-body`, `binary-ref`, unrecognised) that D4 affects. Include them in the dev count and in the PROD query.
- **Ticket reference.** The ticket's "compare with HEL-1408's timestamp inference" points at a blank-cells-null change (7ed157584), not timestamp inference. Name the comparison actually made.
