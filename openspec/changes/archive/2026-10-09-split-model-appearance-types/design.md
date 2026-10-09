## Context

See proposal.md. Base: origin/main b409172a. File `backend/src/main/scala/com/helio/domain/model/model.scala`, 1306
lines, package `com.helio.domain.model`, last touched by HEL-1304 (60fdb87d). The seam (line numbers at b409172a):

- 206-209: `ChartLegend`, `ChartTooltip`, `ChartAxisLabel`, `ChartAxisLabels` (one-line case classes).
- 210-216: `final case class ChartAppearance(...)`; 217 blank; 218: `final case class PanelAppearance(...)`; 219 blank.
- 220-374: `object ChartAppearance` (`Default`, `Patch`, `Patch.decode` + private decoders, `applyPatch`).
- 399-491: `object PanelAppearance` (`Default`, `private val log`, `Patch`, `Patch.decode`, `applyPatch`,
  `applyPatchJson`). 375-398 (`DashboardLayoutItem`, `DashboardLayout`, `object DashboardAppearance`,
  `object DashboardLayout`) are NOT part of the seam and stay.
- Moved code is the only user in model.scala of `import com.helio.api.http.RequestValidation` (line 3) and
  `import org.slf4j.LoggerFactory` (line 7); `spray.json._` is still used by `QueryParams` and stays.

Consumers (all same-package or wildcard/explicit imports of `com.helio.domain.model`, so none need edits):
`api/protocols/panels/PanelProtocol.scala:225-230` (`jsonFormatN(X.apply)` for all six types), `PanelServiceHelpers`,
`PanelRepository`, `PanelMutationRepository`, `DashboardSnapshotRepository`, `DashboardProtocol`, the patchset
services, every `domain/panels/*Panel.scala`, and tests incl. `PanelAppearanceMergeSpec` (same package).

## Goals / Non-Goals

Goals: appearance types in their own files; identical bytecode-level public API, logger name, wire output and test
results; reviewers can see that only moves happened.
Non-goals: see proposal.md. In particular no package change: Scala 2.13 resolves same-package types across files with
no import, so keeping `com.helio.domain.model` makes this source-compatible for every caller; a package move would
force caller edits and change class names (`javap`, logger name) — rejected.

## Decisions

**D1 — Two new files, same package.** A case class and its companion must share a compilation unit, so each pair moves
together.
- `ChartAppearance.scala`: package line, `import com.helio.api.http.RequestValidation`, `import spray.json._`, then
  lines 206-216 (four leaf classes + `ChartAppearance` case class), then 220-374 (`object ChartAppearance`). ~170 lines.
- `PanelAppearance.scala`: package line, `import com.helio.api.http.RequestValidation`,
  `import org.slf4j.LoggerFactory`, `import spray.json._`, then line 218 (`PanelAppearance` case class), then 399-491
  (`object PanelAppearance`). ~100 lines.
Each file keeps only the imports its moved text uses (the executor confirms by compiling; an unused import is removed,
a missing one is added). The leaf chart classes go with `ChartAppearance` because only it composes them.
Alternative considered: one `PanelAppearance.scala` holding both (~275 lines, over the 250 soft budget) — rejected.
Name collision checked: `Panel.scala` exists in the package; neither new name collides.

**D2 — Byte-identical moves.** All moved spans are top-level (column 0), so each moved line is byte-identical to its base
line, doc comments included. The only permitted non-move lines: the `package` line, imports, blank separator lines, and
(in model.scala) deletion of the moved spans plus the two now-unused imports. No positional comment words in the moved
text refer to file layout ("above" in `PanelAppearance.applyPatchJson`'s doc refers to `deserializationError(...)` in
the same object, which moves with it, so it stays true). Removing a span from model.scala must not leave two adjacent
blank lines where there was one (whitespace is allowed, but keep the file tidy).

**D3 — model.scala after.** Equal to the base file with lines 3, 7, 206-216, 218, 220-374 and 399-491 removed (plus at
most the blank-line adjustments around the removed spans). Expected ~1040 lines. Still over budget: out of scope; the
PR body proposes the next seams (e.g. auth/token types, alert types, pipeline types).

**D4 — Logger name.** `object PanelAppearance` keeps `LoggerFactory.getLogger(getClass)`; since the object's FQCN is
unchanged (`com.helio.domain.model.PanelAppearance$`), so is the logger name. Proven by D6b (class names unchanged).

**D5 — Wire guard (new test, committed BEFORE the move).** Add
`backend/src/test/scala/com/helio/api/protocols/panels/PanelAppearanceWireGoldenSpec.scala`: for representative values
(`PanelAppearance.Default`; a panel with `chart = Some(ChartAppearance.Default)`; a chart with `chartType = None` and
`label = None`; the result of `PanelAppearance.applyPatchJson` on a chartless panel with a partial chart patch), assert
`toJson.compactPrint` equals a literal golden string AND that `convertTo` round-trips to the same value, using the
production implicits (mix in or import the real `JsonProtocols`/`PanelProtocol`, never a locally re-declared format).
Also assert `PanelAppearanceResponse.fromDomain(...)` serializes to its golden string. Goldens are captured from the
UNMODIFIED base code and the spec is committed and green on the base before any move commit. Red run: temporarily
mutate production (e.g. change `ChartAppearance.Default`'s legend position), show the spec red, revert.

**D6 — Evidence (in this change dir; helper scripts may live in a `move-check/` subdir as in
`archive/2026-10-08-split-pipeline-run-service`).**
(a) `move-evidence.md`: a mechanical checker, both directions. Forward: each moved span's base text
(`git show b409172a:<model.scala>` by line range) equals its text in the new file. Reverse, POSITIONAL: walking each of
the three resulting files top to bottom, every non-blank line is consumed by the next expected item (a moved span, a
kept model.scala span, or an allow-listed scaffold line: package/import); any extra, missing or altered line fails.
Coverage: every NON-BLANK base line of model.scala is either kept, moved exactly once, or one of the two removed
imports. Blank base lines are exempt from coverage (the blank lines around removed spans, e.g. 217 and 219, legitimately
disappear), but the reverse walk still fails on any non-blank extra line, so a dropped/added blank line cannot hide code. Two red
runs on scratch copies: one token changed inside a moved body (forward fails) and a duplicated existing line (e.g. a
`}`) inserted between spans (reverse fails). Plus a `git diff --color-moved=plain` summary.
(b) `api-evidence.md`: `javap -public` (sbt 2 output dir) before vs after of `ChartLegend`, `ChartTooltip`,
`ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance`, `PanelAppearance` and, for each, its `$` companion, plus
`ChartAppearance$Patch`, `ChartAppearance$Patch$`, `PanelAppearance$Patch`, `PanelAppearance$Patch$`. `javap` always
prints `Compiled from "<file>"`, so the ONLY allowed diff is exactly one `Compiled from` line per class, and the check is
positive: each class's line must change from `model.scala` to the file D1 assigns it (`ChartLegend`/`ChartTooltip`/
`ChartAxisLabel`/`ChartAxisLabels`/`ChartAppearance*` -> `ChartAppearance.scala`; `PanelAppearance*` ->
`PanelAppearance.scala`). Every other line stays byte-identical, except that scalac numbers lambdas per source file, so
synthetic `$anonfun$...$N` suffixes may renumber (amended after cycle 1, see evaluation-1.md); they must match after
normalising only that numeric suffix, with identical types and order. No other filtering; do not reuse the precedent's `javap.sh` filter. Also record that
the full set of `.class` file NAMES under `com/helio/domain/model/` is identical before/after. Red run (main must still compile): add a trailing defaulted
parameter to `PanelAppearance.applyPatchJson`, rebuild, diff non-empty, revert.
(c) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on the base commit (before the golden spec) recording
total succeeded/failed/ignored and per-suite counts for every suite; after the change the per-suite counts are
identical for every pre-existing suite, with exactly the new golden spec's tests added. `PanelAppearanceMergeSpec`
and `git diff b409172a...HEAD -- backend/src/test` show zero edits to existing test files (only the one added file).
(d) `node scripts/check-scala-quality.mjs` passes, and every `s"...${...}"` in the new files is checked by eye for inline
FQNs (the checker is blind inside interpolations, HEL-1386).

## Risks / Trade-offs

- Concurrent lanes (HEL-1393, HEL-1385) touch other backend files; a later merger reconciles imports. This change
  touches only `domain/model/` plus one new test, so a textual conflict is unlikely.
- Machine load: three backend lanes compile tonight. sbt runs under `nice -n 19` with JVM parallelism capped
  (e.g. `-J-XX:ActiveProcessorCount=3`); a full `testFull` runs at most twice (baseline, final) plus targeted suites.
- `AutoRunGuardBurstProofSpec` is a known CI flake (HEL-1439); a timing failure there is recorded, not chased.

## Planner Notes

- Self-approved: two files (D1), file names, keeping the package, adding one golden spec (an additive guard, not a
  behaviour change; the ticket's "only import changes" applies to existing tests, which get zero edits).
- `domain/model/README.md`'s file list is already stale at base (omits `Connector.scala`, `ConnectorCompletionToken.scala`,
  `StepGroup.scala`, `WriteBackSink.scala`); since task 2.4 edits that list anyway, it is corrected to the full set.
- The domain layer importing `api.http.RequestValidation` is a layering smell carried over verbatim; candidate
  follow-up, not fixed here.
