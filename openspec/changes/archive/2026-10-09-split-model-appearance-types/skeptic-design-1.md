## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD b409172a53ebe6f80db154847cb1b85c286293e1 (= origin/main; the change dir is untracked, there are no commits yet).
Base file: `git show b409172a:backend/src/main/scala/com/helio/domain/model/model.scala`, copied to a scratch file.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-model-appearance-types/HEL-1376`.
- **File size claim:** `wc -l` = 1306. Correct.
- **Line ranges (D1/D3), checked line by line with `sed -n Np`:**
  - 206 `final case class ChartLegend`, 209 `ChartAxisLabels`, 210 `final case class ChartAppearance(`, 216 `)`, 217 blank, 218 `final case class PanelAppearance(...)`, 219 blank, 220 `object ChartAppearance {`. Correct.
  - **373 is `  )` (the end of the `applyPatch` constructor call) and 374 is `}`, which closes `object ChartAppearance`.** The design says `object ChartAppearance` is 220-373 and that 374 is `DashboardLayoutItem`. That is wrong: `DashboardLayoutItem` is at **375**. See CR1.
  - 398 blank, 399 `object PanelAppearance {`, 491 `}`, 492 blank, 493 `final case class Dashboard(`. Correct.
- **Imports:** `RequestValidation` (line 3) is used only at lines 269 (comment), 301, 424 (comment), 433, 439 and 445. `LoggerFactory` (line 7) is used only at 406. All of those lines are inside the moved spans. `spray.json._` is still used outside them (`QueryParams` 336-352, `JsValue` at 772/863/879, `JsObject` at 923-924). Correct.
- **Scala version:** `ThisBuild / scalaVersion := "2.13.15"`. The same-package resolution argument in D1 holds.
- **Name collisions:** no other `ChartAppearance`/`PanelAppearance` class or object exists in `backend/src/main/scala`, and `domain/model/` has no `ChartAppearance.scala` or `PanelAppearance.scala`. Correct.
- **Consumers:** `PanelProtocol.scala:225-230` has `jsonFormatN(X.apply)` for all six types. Correct. `PanelAppearanceResponse.fromDomain` exists (PanelProtocol.scala:178). `PanelAppearanceMergeSpec` is in package `com.helio.domain.model` and explicitly imports the moved names from that same package, so it keeps compiling with zero edits.
- **Hidden path-coupled tooling:** I checked whether anything reads `model.scala` by path. `scripts/check-schema-drift.mjs` does (line 27). It uses that path only to read the first `def fromString(s: String)` up to `def asString(t: PanelType)` (lines 152/162, before the seam). It skips `PanelAppearance`/`PanelAppearancePatch` and parses case classes from `api/protocols`, not from the domain. The frontend and helio-mcp drift-guard tests read `CanonicalWireValues` (line 744, a kept span). The move does not affect any of this.
- **Positional comments in kept text:** "above/below/this file" in the kept text (lines 179, 181, 585, 684, 712, 723, 867) never refer to the appearance types. The one in the moved text (480, "`deserializationError(...)` above") moves with its referent, as D2 claims.
- **javap output format (ground truth):** I ran `javap -public` on an existing build of this code (`backend/target/scala-2.13/classes` in the main checkout):
  ```
  Compiled from "model.scala"
  public final class com.helio.domain.model.ChartTooltip implements scala.Product,java.io.Serializable {
  ...
  Compiled from "model.scala"
  public final class com.helio.domain.model.PanelAppearance$ implements java.io.Serializable {
    ...
    public static final java.lang.String $anonfun$applyPatch$15(com.helio.domain.model.PanelAppearance);
  ```
  This shows two things. (1) Every class's dump starts with a `Compiled from "<source file>"` line. Moving the source changes it on every moved class, so D6b's "diff must be empty unfiltered" cannot hold (CR2). (2) The `$anonfun$` methods are public in Scala 2.13, so they appear in `-public` output. They are stable here because each object body moves whole and their numbering does not change, but they are present.
- **Precedent:** `archive/2026-10-08-split-pipeline-run-service/move-check/javap.sh` filters only `$anonfun$|$deserializeLambda$|$$`. It never dealt with a changed `Compiled from` line, so it cannot be copied as is.
- **Scope against the ACs:** AC1 (MergeSpec plus the full suite with import-only changes) is covered by C1, 3.3 and 3.4. AC2 (no wire change, formats resolve) is covered by D5, D6b and compilation. AC3 (no inline FQNs) is covered by D6d. Nothing goes beyond the ticket: the golden spec is the driver-requested guard, and the README edit is a documentation list. No placeholders or TBDs.
- **Does the evidence plan catch a real regression?** Yes, once the CRs below are fixed:
  - The byte-move checker catches changed default values, bodies and doc text.
  - javap catches signature, default-arity, class-name and logger-FQCN drift (the logger name is `getClass` of the unchanged `PanelAppearance$`).
  - The goldens catch wire drift (including `Default` values, which javap cannot see).
  - Per-suite counts catch a test quietly not running.
  - Each layer has a planned red run, and the red runs target the right layers.

### Verdict: REFUTE

The plan is sound and well-defended. However, its proof rests on exact line ranges and an exact "empty diff" claim, and two of those statements are wrong against ground truth. An executor who follows them literally would either break the build or have to deviate quietly from the stated acceptance signal. Both are cheap to fix.

### Change Requests

1. **Fix the `object ChartAppearance` range: it is 220-374, not 220-373.** At b409172a, line 373 is `  )` and 374 is `}`. `DashboardLayoutItem` starts at 375. Correct every occurrence:
   - design.md Context: "220-373", and "374-398 ... stay", which should become "375-398".
   - design.md D1: "then 220-373".
   - design.md D3: the removal list "220-373".
   - tasks.md 2.1: "220-373".

   As written, D3 leaves an orphan `}` in model.scala, and the D6a forward/coverage checker would be built on the wrong span.
2. **Make D6b's javap acceptance signal achievable and exact.** `javap -public` always prints `Compiled from "<file>"` (verified above: `Compiled from "model.scala"`). After the move it necessarily changes to `"ChartAppearance.scala"` / `"PanelAppearance.scala"` on every moved class and companion, including `$Patch`/`$Patch$`, so "Diff must be empty unfiltered" is unattainable. Restate the signal:
   - The only permitted diff is exactly one `Compiled from` line per dumped class.
   - Each must change from `model.scala` to the file name D1 assigns that class. Assert that mapping positively: it is itself evidence the class landed in the right file.
   - Everything else must be byte-identical, and that explicitly includes the `$anonfun$` lines, which are public in 2.13 and expected stable because each object body moves whole.
   - No other filter is allowed. If anything else differs, record it as a finding rather than filtering it.
   - Do not reuse the precedent's `javap.sh` filter unmodified.
   - Mirror the same statement in tasks.md 3.2 / C4.
3. **Make D6a's coverage clause consistent with D2/D3's blank-line allowance.** Coverage currently reads "every base line of model.scala is either kept, moved exactly once, or one of the two removed imports". That excludes base blank lines 217 and 219 (and any blank D3 tidies away), which are neither kept nor moved. Either:
   - state that blank base lines are exempt from coverage, or
   - add "or a base blank line dropped by the D3 tidy, listed explicitly by line number".

   Otherwise the checker either fails on a correct move or gets loosened ad hoc during execution.

### Non-blocking notes

- The "~1035 lines" estimate for model.scala afterwards: 1306 - 2 imports - 11 - 1 - 155 - 93 = 1044, before blank tidying. The estimate is harmless, but it should not be used as an acceptance number.
- The `domain/model/README.md` file list is already stale at base: it omits `Connector.scala`, `ConnectorCompletionToken.scala`, `StepGroup.scala` and `WriteBackSink.scala`. Adding only the two new files is in scope. Fixing the rest is a scope call: either list it as a follow-up in 3.5 or state it explicitly, but do not fold it in silently.
- `test/scala/com/helio/api/protocols/panels/` does not exist yet, so D5 creates a new test directory. That is fine; just noting it.
- After the CR1 fix, removing 375-398's neighbours leaves base blanks 205, 217 and 219 adjacent. That is the D2 tidy case: expect to drop two of them, and list them per CR3.
