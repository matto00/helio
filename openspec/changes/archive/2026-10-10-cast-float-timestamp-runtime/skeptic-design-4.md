## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 719710c15d457de02bcb681192275f2f011268dc. The change dir is untracked and there is no code diff yet. I checked every claim below against the live worktree. I did not run sbt.

### What I verified (with evidence)

- **Round-3 CR1(a) is fixed.** C2 now splits assertions into RED (must fail pre-fix, recorded in 1.8) and GUARD (proven by mutation). C2 names the RED set explicitly, and task 1.8 requires a RED/GUARD listing.
- **Round-3 CR1(b) is fixed.** Task 1.9 adds mutations M1–M4:
  - M1 covers C5 / ruling 2: the check moved into `validateRawConfig`.
  - M2 covers the D3 union: the predicate shrunk to `looksLikeTimestamp`.
  - M3 covers ruling 3: the kept value trimmed or normalised.
  - M4 covers D5: `case _ => str` re-added.

  Each one names the assertions it must turn red.
- **Round-3 CR1(c) is fixed.** Task 1.7 now requires a `Double` under `string-body` that must stay a `Double`. That assertion is red on the pre-fix tree, because CastStep.scala:69-81 does `v.toString` and then `case _ => str`.
- **Round-3 non-blocking notes are absorbed.** The JSON epoch `Double` → null case is in D3/Notes and task 1.1. The `"42"`-kept-as-epoch case is in task 1.1.
- **The write-only routing (D4/C5) holds on the live tree.**
  - Every `PipelineStep.rawConfigProblem` call site is a write path: PipelineService.scala:562, :1858, :2212; PipelineProposalService.scala:295; PatchSetApplyResolvers.scala:204, :576, :737.
  - The update path at :2197-2207 skips config validation when `config` is absent. So toggling `enabled` or changing `position` on a stored legacy cast step stays possible.
  - `RunConfigGate.stepConfigReasons` (RunConfigGate.scala:18-23) → `PipelineAnalyzeService.stepConfigProblem` → `StepConfigValidation`, which calls `validateRawConfig` (:49) plus `requiredConfigProblems` (:62). It never calls `rawConfigProblem` or `inferCast`, so the new hook cannot gate scheduled runs or auto-runs.
  - The default `requiredConfigProblems` is `Vector.empty` (PipelineStep.scala:241), so the manual-run gate is unaffected too.
- **The D3 predicates match the code.**
  - `DateBucketStep.parseToUtcDate` (DateBucketStep.scala:158-169) is private, trims, and accepts epoch values via `toLong`; `parseNonEpochDate` is public.
  - `TimestampParsing.looksLikeTimestamp` does not trim and adds `MM/dd/yyyy`.
  - The union keeps every value datebucket buckets today.
- **The D4a/D2 projections match the code.**
  - `inferCast` (ColumnSchemaInference.scala:31-35) applies `canonicalizeLegacy` to every target.
  - `canonicalizeLegacy` (model.scala:449-454) maps number/double→float, long→integer and date→timestamp.
  - D4a's passthrough for non-supported targets matches D5's runtime passthrough.
- **D6 matches the code.**
  - `castRuntimeTargets` (AnalyzeSchemaWarnings.scala:69) excludes float, and `castTrusted` is at :255-256.
  - `family` maps timestamp to `None`.
  - The flipped case at AnalyzeSchemaWarningsSpec.scala:333-337 is called out in task 1.4.
- **The task 1.6 filter assertion is genuinely red pre-fix.** FilterStep.scala:110-121 coerces `=` to a number only through `numericFieldValue` (:144-152), which is `None` for a String.
- **The inventory is complete. No current emitter writes a target that would now be rejected.**
  - UI picker: CastFieldsConfig.tsx:8 offers string/integer/long/double/boolean.
  - First-run: FirstRunPlanner.scala:36 uses `"double"`.
  - Persona templates go through the same `castStep`.
  - Assistant tool schemas show only an `integer` example (AssistantProposalToolSchemas.scala:283, :331).
  - helio-mcp has no enumeration of cast targets.
  - Every cast target in test/fixture/e2e/docs is in the supported set, except frontend Redux-only `applyCreatedStep.test.ts` (`"int"`, `"me"`). That test never reaches the backend validator.
- **The spec delta is archive-safe.** The MODIFIED header matches openspec/specs/pipeline-cast-op/spec.md:6 verbatim. The ADDED requirement name is new.
- **Owner rulings and the status-code note are reflected faithfully:**
  - Ruling 1 (null-on-unparseable): D3 plus the "Unparseable … yields null" scenario.
  - Ruling 2 (reject-at-write with tested passthrough): D4, D4a, D5, the ADDED requirement, and tasks 1.2, 1.5, 1.5a, 1.7.
  - Ruling 3 (keep the original string): D3, M3, and the untrimmed cases in 1.1.
  - The 422 status follows the shipped `pipeline-step-config-rejection` spec.
- **No placeholders, contradictions or scope drift remain.** Every acceptance criterion maps to tasks:
  - Inventory: the design table.
  - Explicit fallthrough: D5 and M4.
  - Red-first float/timestamp tests plus a pipeline-level test: 1.1, 1.3 and 1.6.

### Verdict: CONFIRM

### Non-blocking notes

- **C2's GUARD wording is broader than 1.9.** C2 says GUARD assertions are "proven by the recorded mutation checks in 1.9, never by green alone". But M1–M4 cover only the load-bearing guards (C5, the D3 union, ruling 3, D5). Some guards have no mutation:
  - unchanged string/integer/long/double/boolean behaviour (1.1)
  - the `abs($x)` no-warn case (1.4)
  - the float/timestamp projections (1.5a)
  - accepts-every-supported-target (1.2)

  The final gate should read C2 as "the load-bearing guards are proven by M1–M4". If the orchestrator wants to remove the ambiguity, reword C2 to say so. The executor may also add a mutation for the 1.4 no-warn case: remove `float` from the trust set and expect red.
- **A UI-side consequence for the PR body.** A stored legacy-target cast step can no longer be edited with its config included. Any edit that resubmits the `casts` map returns 422 until the legacy entry is removed. That follows from ruling 2, but the PR body should name it next to the prod count query.
- **SQL timestamp objects.** If any source ever materialises a non-String timestamp object (e.g. `java.sql.Timestamp`), D3 turns it into a String under a timestamp/date cast. That is consistent with D7 (timestamp family `None`), but worth a sentence if the executor confirms such a source exists. I did not find one.
