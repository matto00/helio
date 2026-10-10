## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 16aed1935e4162594c437662789f1202b3f10021. The review base was resolved live with `resolve-review-base.sh`: 719710c15d457de02bcb681192275f2f011268dc (exit 0). The working tree also has an uncommitted design.md amendment, which I reviewed. It only narrows D4's claim and adds two out-of-scope notes (duplicateStep, and a 422 on PATCH of a stored legacy step). Neither contradicts the code.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/cast-float-timestamp-fallthrough/HEL-1436`.

- **Production diff, read in full.** It covers 5 main files.
  - `CastStep.scala`:
    - `SupportedTargets` is a single constant.
    - `float`/`number` share the `double` case and produce a `Double`.
    - `date`/`timestamp` keep the original `str` only when `TimestampParsing.looksLikeTimestamp || DateBucketStep.parsesAsDate` accepts it. Otherwise they yield `null`.
    - The catch-all `case _ => v` is explicit and commented.
    - `writeConfigProblem` holds the unsupported-target message.
  - `PipelineStep.rawConfigProblem` = `validateRawConfig(raw).orElse(writeConfigProblem(raw))`.
  - `ColumnSchemaInference.inferCast` filters by `SupportedTargets` before canonicalizing (D4a).
  - `AnalyzeSchemaWarnings.castRuntimeTargets = CastStep.SupportedTargets.toSet`.
  - `DateBucketStep.parsesAsDate` exposes the existing parser.
  - Nothing beyond the design is in the diff.

- **AC1 (inventory + castValue handles every accepted type).**
  - design.md has the inventory table.
  - Every `SupportedTargets` entry has an explicit case.
  - Unsupported targets are rejected at write, per owner ruling 2.
  - Existing producers only emit supported targets:
    - UI picker: string/integer/long/double/boolean.
    - `FirstRunPlanner`: `double`.
    - Assistant tool schema examples: `integer`.

- **AC2 (no silent fallthrough).** The old `case _ => str` is gone. The remaining `case _ => v` is the owner-ruled legacy passthrough. Analyze projects the input type for it (D4a), so analyze and run agree.

- **AC3 (red-first, pipeline-level).** I reproduced this myself.
  - Setup:
    - a throwaway detached worktree at 719710c15 with HEAD's test files copied in;
    - compile-only stubs added: the `SupportedTargets` constant and `parsesAsDate`, with no behaviour change, because the parity spec references them;
    - the 8 specs run with `sbt -J-Xmx3g -batch testOnly`.
  - Result: exit 1, `[hel1468-guard] ScalaTest summary: failed=29`.
    - Every failing test is RED-labelled.
    - No GUARD failed pre-fix.
  - The failure messages are the bug itself, not setup errors:
    - `Vector("1.50", "2.25", "x") was not equal to Vector(1.5, 2.25, null) (CastPipelineRunSpec.scala:102)`
    - `Vector() was not equal to Vector("1") (CastPipelineRunSpec.scala:113)`
    - `"1.5" was not equal to 1.5 (CastStepSpec.scala:18)`
    - `List("2.5", "hello") was not equal to List(2.5, "hello") (CastRuntimeParitySpec.scala:78)`
  - CastPipelineRunSpec goes through `PipelineRunService.submit(isDry=false)` against embedded Postgres, started via `VerifiedEmbeddedPostgres.start`. It reads the persisted `node_snapshots` back, so it exercises the real production run path.

- **Green at HEAD.** Run in the worktree: `testOnly` over CastStepSpec, CastSupportedTargetsSpec, CastRuntimeParitySpec, CastPipelineRunSpec, CastTargetWriteRoutesSpec, NumericOpOnTextFieldWarningSpec, AnalyzeSchemaWarningsSpec, PipelineProposalServiceValidateSpec and DateBucketStepSpec.
  - Result: exit 0, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 173, failed 0`.
  - I confirmed all 9 spec names appear in the log.
  - For the full suite I rely on evaluation-2's pasted `testFull` output (`failed=0`, 6627 succeeded, 4 canceled `HELIO_MEASURE`). It is pasted and unambiguous, and its count delta is explained.

- **C5 (write-only rejection; stored legacy casts never gated).**
  - Callers of `rawConfigProblem`, enumerated by grep: these are all write paths.
    - `PipelineService:562` (single-call create), `:1858` (step create) and `:2212` (step update)
    - `PipelineProposalService:295`
    - `PatchSetApplyResolvers:204/576/737`
  - The gate paths call `validateRawConfig` directly:
    - `RunConfigGate.stepConfigReasons` → `PipelineAnalyzeService.stepConfigProblem` → `StepConfigValidation:49 companion.validateRawConfig`
    - `PipelineSchedulerService:205` uses `RunConfigGate.stepConfigReasons`
    - `AutoRunTriggerService:107` uses `RunConfigGate.stepConfigReasons`
  - `writeConfigProblem` is reachable only through `rawConfigProblem`.
  - **My own M1 mutation**, in a throwaway worktree at HEAD: I appended `.orElse(unsupportedTargetProblem(raw))` to `CastStep.validateRawConfig`. Exit 1, `failed=6`, including:
    - `GUARD (C5): the scheduler/auto-run gate reports no reason for it`
    - `GUARD: validateRawConfig and analyze stepConfigProblem do not report a legacy target`
    - the route-level stored-legacy GUARD

    This matches the M1 section of mutation-evidence.md. So the C5 guards really can fail. I deleted the throwaway worktree afterwards with `git worktree remove` on its exact path; `git worktree list` has no straggler.

- **HEL-1403 warning after the trust flip (HEL-1455 item 3).**
  - `castTrusted` requires every target to be in `SupportedTargets`. After this fix each target emits its projected class:
    - integer/long → Int/Long
    - float/double/number → Double
    - boolean → Boolean
    - string → String
    - timestamp → String (family `None`, so it never warns)
  - The cast-then-numeric cases are correct:
    - `{price: float, s: string}` → `abs($s)` warns on `s`. This was RED pre-fix (I reproduced it).
    - `abs($price)` with price cast to float does not warn.
    - Timestamp does not warn.
  - The flipped AnalyzeSchemaWarningsSpec case (a float key joined to a string key now warns `TypeMismatch`) is the right outcome, because the run really compares Double against String.
  - A legacy target stays untrusted. That is conservative and correct.

- **Analyze/apply parity.** `CastRuntimeParitySpec` iterates `CastStep.SupportedTargets` itself, so a new target added without a runtime case fails it. For `timestamp`, it asserts the D3 predicate. All 9 targets pass at HEAD; float, number, date and timestamp failed pre-fix.

- **Spec delta.**
  - The MODIFIED header matches the main spec's `### Requirement: Cast op retypes specified fields per a casts map` exactly.
  - All 6 existing scenarios are kept.
  - `openspec validate cast-float-timestamp-runtime --strict` → `Change 'cast-float-timestamp-runtime' is valid`.

- **Scope.** Backend only; no frontend files changed, so the UI/design step was skipped. No contract or schema file enumerates cast targets: `schemas/` has none, and the OpenSpec scenarios use only supported targets. Nothing went beyond the ACs plus the owner/driver additions.

- **sbt hygiene.** Every run used `-batch -Dsbt.server.autostart=false`, so no sbt server was started. I left no `active.json` and no process.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body must carry the owner/driver items:
  - `date`/`timestamp` casts over junk now return `null` (behaviour change);
  - the rejection status is 422, not the 400 named in the escalation;
  - legacy passthrough now keeps the original value class, not `toString`;
  - a JSON epoch Double under `date`/`timestamp` → `null`;
  - the read-only PROD count query of cast steps by target, including `string-body`/`binary-ref`/other.
- Evaluation-2's note still stands. The stored-legacy runtime passthrough (task 1.7) is proven through the flat engine (`executeWithStepCounts`), not through `PipelineRunService.submit`. The risk is low, since both share `CastStep.apply`.
- Two follow-ups worth filing:
  - `duplicateStep` copies legacy cast rows without `rawConfigProblem` (pre-existing, every kind).
  - The UI picker does not offer `float`/`date`/`timestamp`, so a stored cast with one of those targets may not render well in the step card.
- `float`/`number` now reach `"NaN".toDouble` / `"Infinity"` the same way `double` already did (pre-existing behaviour, not introduced here).
