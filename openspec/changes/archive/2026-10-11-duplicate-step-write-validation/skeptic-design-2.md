## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: 39ff63546e4baa283d73563ac94693269f68abf7 (branch bug/duplicate-step-cast-picker/HEL-1476; change dir untracked).
Base drift: `origin/main` is one commit ahead (9e51550f1, HEL-1490). It does not touch ConvertFormatConfig.scala, PipelineStepWrites.scala, CastStep.scala, CastFieldsConfig.tsx or RunConfigGate.scala (`git diff --stat HEAD origin/main -- <those>` is empty).

### What I verified (with evidence)

**Round-1 CR1: the convertformat draft resolution (design D2, task 1.0) is sound.**
- **Create stays the same.** Create validates the raw request with `PipelineStep.rawConfigProblem(req.type, req.config.compactPrint)` (PipelineStepCreate.scala:36; preflight :155; proposal :298; update PipelineStepWrites.scala:71). That runs before any typed encode, so the writer's output never reaches the check. `pairError` (ConvertFormatConfig.scala:48-62) is untouched, so an explicit `""`/`""` pair in a request is still a 422.
- **Decode stays the same.** `decode` reads an absent `from`/`to` as `""` (:22-23), so omitting them leaves the typed value unchanged, and `readFromWire` delegates to `decode` (:39). After the change, `encode(existing)` for the seed draft is `{"field":"","outputField":""}`. `pairError` sees `(None, None)` and returns `None`, so duplicate gets past D1.
- **Persistence and duplicate.** Both persistence (`encodeConfig`, ConvertFormatStep.scala:322) and duplicate (`PipelineStepConfigCodec.encode`, :40-45) go through this writer. Existing stored drafts are therefore re-encoded without the empty keys at duplicate time, with no migration. That matches D2's claim.
- **Wire response (step).** `ConvertFormatStepResponse` uses the same format (PipelineStepProtocol.scala:340), so a draft's response will omit `from`/`to`. The frontend already tolerates this:
  - the types are optional (`from?`/`to?`, pipelineStep.ts:198-201);
  - `convertFormatConfigOf` passes `cfg.from`/`cfg.to` through (stepNarrowing.ts:817-826);
  - ConvertFormatConfig.tsx's `pairKey` maps undefined to `""`, giving `"->"` and the placeholder. That is the same render as `""`/`""` today (:27-29, :56-67, :96).
- **Wire response (analyze).** `ConvertFormatAnalyzeStepResponse` carries the same typed config (PipelineAnalyzeProtocol.scala:180), so the frontend tolerance above applies here too.
- **Incidental improvement.** Today the stored `""`/`""` pair flows into card state through `convertFormatConfigOf`, so editing only `field` re-sends `"from":"","to":""` and gets a 422 from update. After the change that cannot happen.
- **Analyze and run gates.** `StepConfigValidation` (:49-62) and `RunConfigGate.stepConfigReasons` both read `encode(step)`.
  - A stored draft is still flagged, because `requiredConfigProblems` (ConvertFormatStep.scala:333-341) reports a missing `field` and the `''->''` pair.
  - Only the text changes: the old message was the `pairError` "Invalid 'convertformat' config: unsupported from/to pair" shape-rejection. The new one is the required-config pair. Both contain "unsupported from/to pair", which is what PipelineAnalyzeServiceSpec.scala:670 asserts, and that test uses a present `csv->markdown` pair in any case.
  - The run/gate outcome is unchanged.
- **MCP, patch-sets, schemas, existing tests.**
  - helio-mcp only documents the shape (write.ts:522).
  - The patch-set encode paths are panel-only (`PanelConfigCodec`).
  - `schemas/` has no convertformat config schema (no matches for `convert`).
  - No backend or frontend test pins an encoded `"from":""` (no matches).
- **Cast legacy targets survive the round trip.** `CastConfig.decode` keeps arbitrary strings (CastStep.scala:21-25), and `unsupportedTargetProblem` is a write-only check (:104-115). So D1 on `encode(existing)` will actually reject a stored `binary-ref`, and the red test in 4.1 is reachable.

**Round-1 CR2 (per-kind draft-safety enumeration) is addressed.** D3's "Draft-safety half" and task 4.2a require a table-driven `rawConfigProblem(encode(decode(draft)))` check for every registered kind, naming generatetext and analyze_with_ai explicitly.
- For those two, `validateRawConfig` runs the full `validate` (GenerateTextStep.scala:95-96, AnalyzeWithAiStep.scala:191-192), and the frontend defers create until the config is complete (`requiresCompleteConfigForCreate`, stepNarrowing.ts:191). The only reachable drafts are therefore complete configs, which survive the round trip.
- `strictDecodeProblem` only rejects `StepConfigTypeMismatch` (PipelineStep.scala:216-221). A typed re-encode emits only correctly typed values, so default-validator kinds pass the round trip by construction.

**Round-1 CR3 is addressed.** Task 4.2 requires that duplicating a convertformat step created from `{"field":""}` returns 201, that this case is red on a D1-only implementation, and it keeps `{"casts":{}}` plus one HEL-1416 draft of another kind.

**Whole plan, re-reviewed fresh.**
- **AC coverage:**
  - AC1 → D1/D3, tasks 1.1/4.1
  - AC2 → D2, tasks 1.0/4.2/4.2a
  - AC3 → D4/D5, tasks 2.1/2.2/4.4/4.5/4.6
  - AC4 → D6, task 3.1
  - AC5 → task 4.3
- **Premises still hold.**
  - The duplicate route still skips `rawConfigProblem` (PipelineStepWrites.scala:234-291).
  - `CAST_TARGET_TYPES` is still the five-value list (CastFieldsConfig.tsx:8).
  - `SupportedTargets` is still a single `Vector(...)` literal (CastStep.scala:72-73).
- **Clean on the gate checks.** There are no TBD/TODO placeholders in the artifacts and no contradictions between proposal, design and tasks. The non-goals (don't change what create/update accept; don't touch the run/analyze gates) are respected by the D2 resolution.

### Verdict: CONFIRM

### Non-blocking notes
- **Proposal Impact list.** proposal.md "Impact" does not list `ConvertFormatConfig.scala`, the new task 1.0 file. Add it for accuracy.
- **Record the convertformat side effects.** The executor should note in the evidence that:
  - a draft's step/analyze responses now omit `from`/`to`;
  - the analyze `validationError` for a stored convertformat draft changes from the shape-rejection wording to the required-config wording (field missing plus pair).
  Both are benign, but they are observable changes.
- **Stored `""` cast target (carried over from round 1, still unaddressed).** In D5, a stored `""` target is "set and not in CAST_TARGET_TYPES". It would add a disabled option whose `value`/React `key` collides with keep-as-is (`""`). Exclude `""` explicitly.
- **Proving 4.2 red.** To show 4.2 is red on D1-only, implement 1.1 before 1.0 (or temporarily revert 1.0). The task list orders 1.0 first.
- **Re-check after rebase.** HEL-1490 (now on origin/main) changed `Select` (an invalid state). Re-check the D5 disabled-selected rendering after rebase. Task 4.3 depends on HEL-1504's `RunConfigGate`, which is also worth re-checking after rebase.
- **Possible follow-up.** Duplicate still skips create/update's secondary-source ACL, lane and upsert-ownership checks. That is outside this ticket and may merit a follow-up.
