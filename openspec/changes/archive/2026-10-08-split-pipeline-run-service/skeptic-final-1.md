## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `8cb6c3baa8841f9e5ff26fe29b81734fee22b649` against the live-resolved base
`4db9730fd0907a4d769b7a0b80082ac260d499d6` (`resolve-review-base.sh`, exit 0; `git merge-base HEAD origin/main` agrees).
Worktree clean apart from the untracked `evaluation-1.md`. Backend-only change, so there is no UI step.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-run-service/hel-1371`.
- **Moves vs edits, two independent checks of my own (not the executor's check.py):**
  - *Multiset line diff* of the base file against the concatenation of the 7 new files. Every added line is one of these: package/imports,
    class docs and headers, constructor params, `private val log = LoggerFactory.getLogger(classOf[PipelineRunService])` (x6),
    `import support./terminal./succeeded./executor.` member imports, the 6 wiring vals, the 4 delegations (doc + signature + body),
    `private` -> `private[pipelines]` on 14 signatures, closing braces and blanks. Every removed line is one of those 14 `private def`
    signatures or a pruned import line. No body line was added or removed.
  - *Positional check* (`difflib.SequenceMatcher` per new file against the base, counting only runs of 3+ lines). Every unmatched new line
    is scaffold of the kinds listed above. The only base body lines left uncovered are the 14 visibility-changed signatures and two
    single `}` lines where the matcher aligned differently. I checked those by eye: base 383-387 = Executor 80-84, and base 1224-1228 is
    intact. This rules out reordering inside a member, which a multiset check alone would miss.
- **Name binding after the move.** For every base member name and constructor-parameter name, I checked each new file for a reference
  that is not bound locally (def/val/ctor param/explicit member import). Each flagged hit was inside a comment or a string literal
  (e.g. "requires the in-process engine"). No moved body silently binds to a wildcard import or package member. There is no package object.
- **Implicit resolution under shrunken imports.** The base's only lexical implicits were `spray.json._`, `DefaultJsonProtocol._` and
  `schemaFieldJsonFormat`. The three files without `DefaultJsonProtocol._` (Support, TerminalWrites, Executor) plus Backfill and the
  entry point contain no `toJson`/`convertTo`/`parseJson`/`JsonFormat` use. They only build the JS AST directly (`JsObject`, `JsNumber`, …).
  Queries and SucceededWrites keep `DefaultJsonProtocol._`, and SucceededWrites keeps `schemaFieldJsonFormat`. So no implicit can have
  re-resolved to a different instance.
- **HEL-1366:** `publishTerminalAfter[T](…, writes: => Future[T])` sits in TerminalWrites:33 with its body unchanged
  (`Future.unit.flatMap(_ => writes).transformWith { publish; Future.fromTry }`), and the param is still by-name. The terminal publishes
  are at TerminalWrites:87, 136, 166 and 202 and SucceededWrites:271, and all go through it. Executor's `publish` now resolves to
  `terminal.publish`, which has the same `registry != null` guard.
- **HEL-1370:** the `queued`/`running` publishes (Executor:167-168) still come after the guard admission block (`incrementRateIfUnderLimit`
  at :129). The write-back `recoverWith` still calls `onWriteBackFailure` (Executor:297-308).
- **HEL-1374:** `guardClock` is passed by value to the Executor. Its only read is `guardClock.now()` at Executor:129. The entry point's
  trailing `guardClock: Clock = SystemClock` is unchanged (base ctor lines 35-118 match verbatim in the positional check).
- **Eager-val init order:** the collaborators are declared after `backend` (Service:146-152) in dependency order. Each wiring argument
  matches the collaborator's parameter by name, and all same-file types are distinct, so a swapped argument would not compile. The
  collaborators hold no reference back to the entry point. `RunStatusNotFound` (now a val in Queries) and `historyConfigs` (a def) are
  only used at call time.
- **Logger name (C3):** all 6 new classes use `getLogger(classOf[PipelineRunService])`. The entry point keeps `getLogger(getClass)`
  verbatim, which gives the same name on a final class. Two tests depend on this: StepConfigInvalidRoutesSpec and
  UpsertTargetWritableRoutesSpec. Both pass (re-run below).
- **Public API (C5 / AC3):** compared at the source level. The `def`/`val` signatures of the class and companion (`submit`,
  `recordUnrunnable`, `previewStep`, `previewOutputs`, `backfillOutputNode`, `latestRun`, `runStatus`, `history`, `eventRegistry`,
  `pipelineExists*`, `SparkUnsupportedKinds`, `EmptyTruncationJson`, `composeTruncationNotice`, `TriggerSource.*`) are textually identical
  to the base. The constructor block and companion/sibling block are byte-identical. I also read the executor's javap evidence:
  filtered diff empty, and the red run (an added defaulted param) shows a non-empty diff. I did not rebuild the base for my own javap;
  the source-level identity is the stronger statement here.
- **C1:** `git diff 4db9730fd --stat -- backend/src/test` returns 0 lines.
- **C2:** `ServiceError.Forbidden(` count is 2 in PipelineRunService.scala and 0 in each of the six new files. None of the new files call
  the access helpers (`requireOwnerOnly|requireAccess|authorizeResource*`), and the base had none either, so ExistenceNotLeaked's
  sites guard is unaffected.
- **C4 / AC "no inline FQNs":** `node scripts/check-scala-quality.mjs` reports `clean (216 soft warning(s))`. A grep for `${…com./scala./java.…}`
  in the 7 files returned nothing.
- **Gates re-run myself:** `nice -n 19 sbt testOnly` over PipelineRunServiceTerminalOrderingSpec, PipelineRunGuardIntegrationSpec,
  DatasetWriteAutoRunEndToEndSpec, StepConfigInvalidRoutesSpec, UpsertTargetWritableRoutesSpec, ExistenceNotLeakedRoutesSpec,
  PipelineRunServiceSpec, PipelineRunRoutesSpec and AutoRunGuard*Spec gave `Suites: completed 10, aborted 0` and
  `Tests: succeeded 257, failed 0`, with `Run completed in 59 seconds` (a real execution, not a cache replay). 257 equals the sum of the
  executor's per-suite baseline counts for those suites (10+10+5+12+16+61+87+52+3+1). For the full suite (6145/0/4 baseline = after,
  440 suites, per-suite XML diff identical) I relied on the executor's pasted output in test-count-evidence.md.
- **Evidence failability:** check.py's red runs (a token change caught by the forward check; a copied line outside any member caught
  positionally), the logger red run (5 failures in StepConfigInvalidRoutesSpec) and the javap red run are all pasted. My independent
  checks above do not depend on check.py.
- **AC1 seam:** TerminalWrites and Executor exist under the ticket's names. The `succeeded` publish lives in SucceededWrites (deviation
  D2a, accepted at the design gate) but goes through `PipelineRunTerminalWrites.publishTerminalAfter`.

### Verdict: CONFIRM

### Non-blocking notes
- The entry point is still 634 lines. Moving the previews out needs an ExistenceNotLeaked pin edit; this is follow-up #1 in files-modified.md.
- The entry point's `log` is now unreferenced, `resolvePrimaryDataSourceInternal` is dead, and several doc links/positional comments are
  stale after the move. These are already recorded as follow-ups, which is correct under refactor discipline.
- The `backfillOutputNode` signature comment ("Defaulted to `None`") is false and is now duplicated in the delegation. It was pre-existing
  and moved verbatim. Fix it in the follow-up together with the other stale docs.
- origin/main has moved on (HEL-1313 is in). Reconcile at Delivery and re-run the move check if the rebase touches PipelineRunService.scala.
