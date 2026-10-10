## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 719710c15d457de02bcb681192275f2f011268dc. The change dir is untracked and there is no code diff yet. I checked every claim below against the live worktree tree. I did not run sbt.

### What I verified (with evidence)

- **Round-2 CR1 (status code) is fixed.** The proposal, the spec delta and task 1.5 now all say 422, and design D4 names the shipped `pipeline-step-config-rejection` spec. The ticket.md status-code note records that "(400)" was the orchestrator's wording, not the owner's. Every `rawConfigProblem` call site is a write site:
  - PipelineService.scala:562, :1858, :2212
  - PipelineProposalService.scala:295
  - PatchSetApplyResolvers.scala:204, :576, :737
- **D4 / C5 holds (write-only).**
  - `PipelineStep.rawConfigProblem` (PipelineStep.scala:283-284) is the only shared write lookup, so chaining `writeConfigProblem` inside it is enough.
  - `RunConfigGate.stepConfigReasons` is reached by PipelineSchedulerService.scala:205 and AutoRunTriggerService.scala:107. It goes through `PipelineAnalyzeService.stepConfigProblem` → `StepConfigValidation`, which calls `validateRawConfig` directly, so it never sees the new hook.
- **Round-2 CR2 (pre-fix-red downstream assertion) is fixed.** In FilterStep.scala:110-121, `=` coerces numerically only through `numericFieldValue` (:144-152), which returns `None` for a String.
  - Pre-fix: `"1.50"` is compared as a string against `"1.5"`, so there is no match.
  - Post-fix: `Double 1.5 == 1.5`.
  - So task 1.6's filter assertion is genuinely red-first. The infrastructure for a real run exists: InProcessPipelineEngineSpec already builds CsvSource temp files (:1974-1990) and uses `VerifiedEmbeddedPostgres.start` (:79).
- **D3 predicate union matches the code.**
  - `DateBucketStep.parseToUtcDate` (DateBucketStep.scala:158-169) is private. It trims, and accepts epoch values via `toLong`, then falls back to `parseNonEpochDate` (:174-179).
  - `TimestampParsing.looksLikeTimestamp` (TimestampParsing.scala:15-19) does no trim and has an `MM/dd/yyyy` branch.
  - With the union, every value datebucket buckets today survives a date/timestamp cast.
- **D4a / D2 projections.** `canonicalizeLegacy` (model.scala:449-454) maps number/double→float, long→integer and date→timestamp. `inferCast` (ColumnSchemaInference.scala:31-35) applies it to every target today. D4a's passthrough for non-supported targets is consistent with D5.
- **D6 matches the code.** `castRuntimeTargets` (AnalyzeSchemaWarnings.scala:69) excludes float. `typesPreserved` → `castTrusted` (:122-124, :255-256). `family` (:75-80) maps timestamp to `None`. Task 1.4 now names the intended inversion of AnalyzeSchemaWarningsSpec.scala:332-336.
- **No existing fixture uses a target that would now be rejected.** I grepped `backend/src/test` for cast configs. Targets seen: integer/long/double/string/boolean/date/float, plus empty maps. There are no `string-body`/`binary-ref`/unknown targets on write paths.
- **Owner rulings are faithfully reflected.**
  - Ruling 1: D3, plus the spec scenario "Unparseable … yields null".
  - Ruling 2: D4, D4a, D5, the ADDED requirement, and tasks 1.2, 1.5, 1.7.
  - Ruling 3: D3 keeps the original untrimmed string, plus task 1.1.
- **Red-first audit, assertion by assertion, against the pre-fix code** (`castValue` CastStep.scala:69-81: `date` → str, `_` → str; `validateRawConfig` accepts any string target).
  - These are **red** on the pre-fix tree:
    - float/number → Double
    - junk → null under timestamp/date
    - legacy Double stays Double (pre-fix gives `toString`)
    - write rejection (1.2, 1.5)
    - legacy analyze projection (1.5a: `"foo"` throws → "cast config error"; `string-body` projects verbatim)
    - 1.4's first case
    - 1.3 parity for float/number and timestamp junk
    - 1.6's Double and filter assertions
  - These **pass on the pre-fix tree** (they are guards, not red):
    - 1.1: the timestamp/date keep-original-string cases (including untrimmed and epoch), Long epoch → String form, and existing string/integer/long/double/boolean behaviour
    - 1.2: "accepts every SupportedTargets entry", and `validateRawConfig` / `stepConfigProblem` / `RunConfigGate` NOT reporting a legacy target
    - 1.4: cast float then `abs($x)` does not warn, and the timestamp no-crash case
    - 1.5a: float/number → float and date/timestamp → timestamp projections
    - 1.5b: date → datebucket chain (pre-fix `date` passes the string through)
    - 1.7: a String value passes through, and the scheduler/auto-run gates report no reason

### Verdict: REFUTE

### Change Requests

1. **C2 conflicts with tasks 1.1-1.7 as written, and the load-bearing guards have no failability proof.**
   - **The conflict.** C2 (tasks.md "Standing Constraints") requires "showing each new assertion fails for the right reason" on the pre-fix tree. About half the planned assertions cannot fail there; the red-first audit above lists them. They are guards, not red proofs.
   - **Why it matters.**
     - An executor held to C2 literally cannot satisfy it, so it will either produce misleading "red" evidence or quietly drop the guards.
     - The final gate would then be arguing over C2 instead of the work.
     - The guards that *carry* owner ruling 2 and C5 can only ever be shown green: legacy casts are not gated by the scheduler or auto-run, `validateRawConfig` does not report them, and cast→datebucket chains do not regress. As planned, nothing proves those tests could catch the regression they exist for.
   - **Required changes.**
     - (a) In tasks.md, split each task's assertions into **RED** (must fail on the pre-fix tree, recorded in 1.8) and **GUARD** (passes pre-fix by construction). Reword C2 to apply to the RED set.
     - (b) For each load-bearing GUARD, add a mutation check in section 2/3 that is applied after the fix, shown to turn the guard red, then reverted, with the output recorded in the evidence:
       - **C5 / ruling 2:** put the unsupported-target check into `CastStep.companion.validateRawConfig` instead of `writeConfigProblem`. The 1.2 "validateRawConfig/stepConfigProblem/RunConfigGate do NOT report" assertions and the 1.7 gate assertions must go red.
       - **D3 union:** reduce the timestamp/date predicate to `looksLikeTimestamp` alone. The 1.1 `"2026-07-01 12:00:00"`/`"1751371200"`/untrimmed cases and 1.5b must go red.
       - **Ruling 3:** emit a trimmed or ISO-normalised value. The 1.1 untrimmed / `"03/14/2026"` keep-original cases must go red.
     - (c) Make 1.7's legacy passthrough use at least one non-String input (e.g. a `Double` under `string-body`), so 1.7 is red pre-fix rather than a pure guard. As planned it uses a String value, which `toString` already passes through unchanged.

### Non-blocking notes

- **JSON epoch numbers become null under a date/timestamp cast.** JSON numbers materialise as `Double` (design Context), so a numeric epoch from a JSON source (e.g. `1751371200`) arrives as `Double`. Its `toString`, `"1.7513712E9"`, fails both `toLong` and every parser, so a `timestamp`/`date` cast of it yields null. Datebucket nulls it today too, so no cast→datebucket chain regresses, and ruling 1 covers it. Still, mention it in the PR body next to the `date` null change, and consider one 1.1 line pinning the behaviour so it is a deliberate choice rather than an accident.
- **D3 keeps any integer string as an epoch** (`"42"` kept under `timestamp`). This follows datebucket parity and is acceptable. A one-line test would make the choice explicit.
- **The dev DB exposure counts in the proposal were not independently verified.** They are read-only and not load-bearing for this gate.
