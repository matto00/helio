## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: 39ff63546e4baa283d73563ac94693269f68abf7 (branch bug/duplicate-step-cast-picker/HEL-1476; change dir untracked).

### What I verified (with evidence)

- **Current duplicate path.** `PipelineStepWrites.duplicateStep` (PipelineStepWrites.scala:234-291) runs the ACL, then `decode(kind, encode(existing))`, then `spliceInsertAtInternal`. It never calls `rawConfigProblem`. Premise confirmed.
- **(a) D1 string and ordering.** `encode(existing)` (PipelineStepConfigCodec.scala:40) is the string the round-trip decode consumes. Validating it before decode matches create, which validates the raw request and then persists `encode(decode(raw))`. Note: it is the round-trip *input*, not literally "the exact string duplicate would write". Those are equal only if decode/encode is idempotent. Placing the check after the ACL matches `updateStep` (ACL first, then 422 at :70-73). Create runs its 422 before the pipeline ACL (PipelineStepCreate.scala:35-42), but for duplicate the config comes from a stored row, so checking ACL first is the correct way to mask existence. This part of D1 is sound.
- **(b) D2 does not hold by construction (see CR1).** `rawConfigProblem = validateRawConfig orElse writeConfigProblem` (PipelineStep.scala:289-290) and excludes `requiredConfigProblems`. That part is true. But D2's argument ("anything create accepts passes D1") assumes `rawConfigProblem(encode(decode(x))) == None` whenever `rawConfigProblem(x) == None`. That is false for `convertformat`:
  - The frontend seed is `defaultConfigFor("convertformat") == { field: "" }`, with from/to deliberately omitted (stepNarrowing.test.ts:418-425: "a present-and-empty pair is a 422").
  - Create accepts it because `pairError` only fires when both keys are present (ConvertFormatConfig.scala:48-62).
  - The tolerant decode then defaults `from`/`to` to `""` (:19-25), and the encoder always writes them (:31-37: `"from" -> JsString(c.from)`, `"to" -> JsString(c.to)`). The repository persists `encodeConfig(typedConfig)` (PipelineStepRepository.scala:1361).
  - So the stored row, and therefore `encode(existing)`, is `{"field":"","from":"","to":"","outputField":""}`.
  - `pairError` sees `(Some(""), Some(""))`, which is not in `SupportedPairs` (ConvertFormatStep.scala:45-46), so it returns a 422.
  - Under D1 as written, every unconfigured palette-added convertformat step becomes non-duplicable. That violates AC2 and the ADDED spec scenario "Duplicating an incomplete draft still succeeds". ConvertFormatStep.scala:331-332 already notes that a tolerant-decoded row has `""` from/to.
  - Other overriding kinds I checked are draft-tolerant across the round trip:
    - window, fillnull and pivot check `nonEmpty` before rejecting.
    - compute skips an empty expression.
    - aggregate defaults to empty aggregations.
    - upsertsource's strict target reader accepts `""` id/name (UpsertSourceConfig.scala:92-121).
  - generatetext/analyze_with_ai `validate` were not exhaustively checked. The executor's enumeration must cover them.
- **(c) D4 guard mechanism.** Reading Scala source from jest has real precedent: `controlFitnessDriftGuard.test.ts` (HEL-1084) reads `FormPanel.scala`. The cited HEL-1311 guard (`chartTypes.guard.test.ts`) reads `schemas/`, not Scala, so the citation is slightly off but the mechanism is sound. `SupportedTargets` is a single `Vector(...)` literal at CastStep.scala:72-73. No other frontend cast-target list exists (grep for `CAST_TARGET_TYPES`/`CastTargetType` finds only CastFieldsConfig.tsx).
- **(d) D5 disabled selected option.** `Select.tsx:66`: `selected = options.find(o => o.value === value)` ignores `disabled`, so the trigger shows the disabled option's label. Disabled options render `disabled` + `aria-disabled` (:241-246), and `selectOption` early-returns on disabled (:84). Today an unlisted stored value renders the placeholder "Select…", not "keep as is". The fix direction is still correct. Supported.
- **(e) Ticket coverage.**
  - Item 1 is covered by AC1/AC2 → tasks 1.1, 4.1, 4.2.
  - Item 2 is covered by AC3 → 2.1, 2.2, 4.4, 4.5, 4.6.
  - Item 3 is covered by AC4 → 3.1. `openspec/specs/pipeline-cast-op/spec.md:4` is still "TBD", confirmed.
  - Item 4 is covered by AC5 → 4.3.
  - No AC is left uncovered and nothing is out of scope.
- **(f) Driver directive.** D4 and the spec delta list all nine targets, including `number`, in backend order. Met.

### Verdict: REFUTE

### Change Requests

1. **D2 is false for `convertformat`. Revise D1/D2 so drafts stay duplicable.**
   - The problem: an unconfigured convertformat draft (`{"field":""}`, the frontend seed, which create accepts) is persisted with `"from":"","to":""`. `rawConfigProblem("convertformat", encode(existing))` then returns the pair 422 (evidence chain above). D1 as written would turn that into a duplicate 422, breaking AC2.
   - The design must pick and state a resolution. Options:
     - (i) Make `ConvertFormatConfig`'s encoder omit empty `from`/`to`, so the encoded draft is again "absent" (check the wire/`writeToWire` and frontend read impact).
     - (ii) Some other targeted fix that keeps create's "present-and-empty pair is a 422" contract intact.
     - (iii) Escalate if the trade-off is a product call.
   - Delete the "by construction" claim. Do not change what create accepts as a side effect, which is a declared non-goal.
2. **Add a round-trip draft-safety enumeration to D3/task 4.1.** For every registered kind, record whether `encode(decode(seed))` of an accepted draft (frontend `defaultConfigFor` seed plus the HEL-1416 draft shapes) still passes `rawConfigProblem`. This is the complement of D3's "stored-invalid reachable" enumeration and the property D2 depends on. Cover generatetext and analyze_with_ai explicitly.
3. **Pin it in task 4.2.** Duplicating a `convertformat` step created from its seed `{"field":""}` returns 201. It must be red on the D1-only implementation, which proves the CR1 fix is load-bearing. Keep the `{"casts":{}}` case too.

### Non-blocking notes

- D1 wording: say "the round-trip input `encode(existing)`, the analogue of create's raw request", not "the exact string duplicate would write". The latter is `encode(decode(encode(existing)))`.
- D4: the Scala-reading precedent is HEL-1084's `controlFitnessDriftGuard.test.ts`. HEL-1311's guard reads `schemas/`.
- D5 edge case: a stored target of `""` collides with the keep-as-is option value (both `""`, and also the React `key`). Either exclude `""` from the unsupported-option branch explicitly or test it.
- Task 4.3 depends on `RunConfigGate` continuing to admit legacy targets. HEL-1504 owns that gate concurrently, so re-check after rebase.
- Duplicate also skips create/update's secondary-source ACL, lane and upsert-ownership checks. This is out of this ticket's scope (rawConfigProblem only) and may merit a follow-up.
