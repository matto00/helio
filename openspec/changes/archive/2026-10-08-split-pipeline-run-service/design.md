## Context

See proposal.md. File: `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`, 1770 lines at
4db9730fd: one `final class PipelineRunService(...)(implicit ec)` (lines 38-1695), companion `object PipelineRunService`
(1710-1744), `CachedRunStatus` (1748-1754), `TriggerSource` (1765-1770). ~87 files reference the class; callers use only
its public members (`submit`, `recordUnrunnable`, `previewStep`, `previewOutputs`, `backfillOutputNode`, `latestRun`,
`runStatus`, `history`, `eventRegistry`, `pipelineExists`, `pipelineExistsShared`) and the companion's
`SparkUnsupportedKinds` / `EmptyTruncationJson` / `composeTruncationNotice`.

Hard constraints found while planning (each is a live test, so each must hold with zero test edits):
- `ExistenceNotLeakedRoutesSpec` "pin the per-file count of ServiceError.Forbidden producers" (spec lines 333-338,
  519-530) requires exactly `"PipelineRunService.scala" -> 2` and no new file: the producers are `submit` (line 271)
  and `previewAtNode`'s AI-closure check (line 615). Its rows also name `PipelineRunService.scala` as a site (455-457).
- `StepConfigInvalidRoutesSpec:140` and `UpsertTargetWritableRoutesSpec:173` attach a `ListAppender` to
  `LoggerFactory.getLogger(classOf[PipelineRunService])`; logs emitted by moved code (e.g. `logExecutionFailure`, the
  write-back failure logs) must keep that logger name, which is also what production log queries see.
- `PipelineRunServiceTerminalOrderingSpec` (HEL-1366/HEL-1370, `pg_blocking_pids`-proven ordering),
  `PipelineRunGuardIntegrationSpec`, `AutoRunGuard*Spec`, `DatasetWriteAutoRunEndToEndSpec` (HEL-1374 `guardClock`).

## Goals / Non-Goals

Goals: concern-focused files; identical behaviour; zero test-source diff; reviewers can see moves vs edits.
Non-goals: see proposal.md.

## Decisions

**D1 — Entry point keeps name, package, constructor, public API.** `PipelineRunService.scala` keeps lines 1-118
verbatim (imports may shrink to what remains used): the class doc, the full constructor with every parameter, order,
default and comment, `require(outputRepo != null, ...)`, `log`. It also keeps, verbatim: `urlFetchSeam`, `engine`,
`backend` (same order, still eagerly initialised at construction), `auditSubmit`, `submit`, `recordUnrunnable`,
`previewStep`, `previewOutputs`, `previewAtNode` (C2: both Forbidden producers stay here), `eventRegistry`,
`pipelineExists`, `pipelineExistsShared`, the companion object, `CachedRunStatus`, `TriggerSource`. Public methods
whose bodies move become one-line delegations with an unchanged signature (`backfillOutputNode`, `latestRun`,
`runStatus`, `history`), receiver-qualified (`queries.latestRun(...)`), never via an import that would clash with the
entry point's own public defs. Expected size ~640 lines: still over budget because previews must stay with the pinned
Forbidden producer; the PR description proposes moving previews out as a follow-up (it needs a test-pin edit).

**D2 — Destinations (same package, each a `private[pipelines] final class` with `(implicit ec: ExecutionContext)`).**
Line ranges are at 4db9730fd and include each member's doc comment.
- `PipelineRunSupport` — `logExecutionFailure`, `executionFailureError` (120-138), `truncationFields` (173-201),
  `truncatedReadsToJson` (203-226), `resolvePrimaryDataSourceInternal`, `resolveAllRootDataSourcesInternal` (315-341).
- `PipelineRunTerminalWrites` — `publish`, `publishTerminalAfter` (990-1003), `executeRunFailure` (1120-1168),
  `persistAssertions` (1230-1243), `onDryRunSuccess` (1245-1276), `onWriteBackFailure` (1348-1376), `onBlockedRun`
  (1378-1412), `summarizeBlockingFailures` (1645-1656).
- `PipelineRunSucceededWrites` — `historyConfigs` (1414-1419), `onUnblockedRunSuccess` (1421-1643),
  `extractBinaryRefs`, `isBinaryRefShape` (1658-1693).
- `PipelineRunExecutor` — `runPipeline` (343-387), `executeRun` (1005-1118), `executeRunSuccess` (1170-1228),
  `onRunSuccess` (1278-1329), `applyPendingWriteBacks` (1331-1346).
- `PipelineRunBackfill` — `backfillOutputNode` body, `evaluateNodeRowsForBackfill`, `persistBackfilledRows` (664-809).
- `PipelineRunQueries` — `latestRun`, `runStatus`, `RunStatusNotFound`, `history`, `parseTruncationRecord`,
  `summarizeAssertions` (811-973).
Each class takes exactly the collaborators its moved bodies reference, under the SAME parameter names as the original
constructor (so bodies compile unchanged), plus the sibling collaborators it calls. Names are self-approved; the
executor may not move a member to a different destination without recording why.

**D2a — Deviation from the ticket's literal seam (to be stated in the PR body).** The ticket puts "the terminal
persist-then-publish paths" in `PipelineRunTerminalWrites`. This design keeps four of the five terminal publishes there
(`failed` from `executeRunFailure` :1166, `dry_run` from `onDryRunSuccess` :1275, `failed` from `onWriteBackFailure`
:1375, `failed` from `onBlockedRun` :1411) but moves the fifth, `succeeded` from `onUnblockedRunSuccess` :1642, to
`PipelineRunSucceededWrites`, because that method alone is 223 lines and would push TerminalWrites to ~480. It still
publishes through `PipelineRunTerminalWrites.publishTerminalAfter`, so the one HEL-1366 primitive stays in one file.
The PR body names this deviation and lists which file holds each terminal publish.

**D3 — Bodies move byte-identical.** Members keep their 2-space class-body indentation, so moved text is byte-identical,
doc comments included. Cross-class calls keep their unqualified text via named member imports at the top of each class
body (e.g. `import terminal.{publish, publishTerminalAfter, persistAssertions}`); a receiver-qualified call
(`terminal.x(...)`) is allowed only where an import would be ambiguous, and each one is listed in the evidence. The
only other permitted non-move lines: package/imports, class scaffolding, `private` -> `private[pipelines]` on members
now called across classes, the D1 one-line delegations, collaborator wiring in the entry point, and positional words
in comments ("above"/"below"/"this file") that the move made false.

**D4 — Wiring and initialisation order.** The entry point builds the collaborators as `private val`s declared after
`backend`, passing its own constructor parameters and `backend` by value, in dependency order (support, terminal,
succeeded, executor, backfill, queries). One instance of each per `PipelineRunService` instance; construction does no
I/O, as today. `executionBackend == null` still falls back to `new InProcessExecutionBackend(engine, pipelineStepRepo)`.

**D5 — Logger name.** Every new class logs through `LoggerFactory.getLogger(classOf[PipelineRunService])` (or the entry
point's own `log` passed in), never `getClass`, so the logger name stays `com.helio.services.pipelines.PipelineRunService`.

**D6 — Evidence (in this change dir, scripts in the scratchpad).**
(a) `move-evidence.md`: an inventory table assigning EVERY member of the original class body (each `def`/`val`) to
exactly one destination. A mechanical checker working in BOTH directions: (i) forward: extract each member's text from
`git show <base>:<path>` and from its new file and byte-compare; (ii) reverse: every line of the seven resulting files
must be either part of a moved/kept member's original text or on an explicit allow-list of non-move lines, each tagged
with its D3 category; any other line fails. The reverse check is POSITIONAL (each line is claimed by exactly one member
span or one allow-list entry), never "this text exists somewhere in the base file". Red runs on scratch copies: one
token changed inside a moved body (forward fails) and a COPY of an existing line (e.g. a duplicated `}` or
`Future.successful(())`) inserted outside any member (reverse fails). Plus a `git diff --color-moved=plain <base>`
summary for the PR.
(b) `api-evidence.md`: `javap -public` (sbt 2 output dir) of `PipelineRunService`, `PipelineRunService$`,
`CachedRunStatus`, `CachedRunStatus$`, `TriggerSource`, `TriggerSource$` before vs after, FILTERED to drop compiler
synthetics (`$anonfun$...`, `$deserializeLambda$`, and any name containing `$$`, which Scala 2.13 emits as public for
lambda bodies and accessed privates; ~159 of them leave with the moved members). The filtered diff must be empty (it
still covers the constructor, `$lessinit$greater$default$N`, `submit$default$N`, every public method and companion
member). Red run (must still compile `main`): temporarily add a trailing defaulted parameter to `submit` or narrow `guardClock`'s
declared type, rebuild, show the filtered diff is non-empty, revert.
(c) Logger: a grep showing every new file's only logger is exactly `LoggerFactory.getLogger(classOf[PipelineRunService])`
(or the entry point's `log` passed in) — no test captures most of the moved log sites, so the grep is the guard there.
Red run: temporarily switch `PipelineRunSupport`'s logger to its own `getClass`, run `StepConfigInvalidRoutesSpec`, show
it red, revert.
(d) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on the unmodified worktree (record total
succeeded/failed/ignored plus per-suite counts for TerminalOrdering, GuardIntegration, AutoRunGuard*, DatasetWriteAutoRun*,
PipelineRunService*Spec, ExistenceNotLeakedRoutesSpec, StepConfigInvalidRoutesSpec, UpsertTargetWritableRoutesSpec,
PipelineRunRoutesSpec); the same after the change must match and pass. `git diff <base>...HEAD -- backend/src/test` empty.
The suite outlives a 10-minute Bash call: run it backgrounded to a log file, poll with bounded waits.

## Risks / Trade-offs

- Eager-val initialisation order: a collaborator declared before `backend` would capture `null`. Mitigated by D4 and
  by every run/preview spec exercising `backend`.
- `publishTerminalAfter`'s by-name `writes` must stay by-name across the class boundary (signature moves verbatim);
  the ordering spec is the guard.
- Entry point stays ~640 lines (D1). Accepted: the alternative hides a Forbidden producer from a pinned guard.
- Widening members to `private[pipelines]` exposes them to the package. Accepted; the README already says
  `private[services]` implies no encapsulation, and the classes themselves are `private[pipelines]`.

## Planner Notes

- Self-approved: six destination classes rather than the ticket's two, because "everything else" alone would be ~900
  lines. `PipelineRunTerminalWrites` and `PipelineRunExecutor` keep the ticket's names; the one seam deviation is D2a.
- Doc links made stale by the move are NOT edited (only positional words are, per D3): `truncatedReadsToJson`'s
  `[[PipelineRunService.parseTruncationRecord]]` (:214), `recordUnrunnable`'s `[[runPipeline]]` (:283) and its
  "`onBlockedRun`'s persistence pattern below" (:285). Positional words are edited only where the move made them false
  (keep original member order within each file so e.g. :1150 "below" stays true). Recorded as follow-up candidates (task 3.6).
- `resolvePrimaryDataSourceInternal` has no caller (dead private). It moves verbatim (D3); deletion is a follow-up.
- Driver claims verified: HEL-1366 `publishTerminalAfter` (990-1003), HEL-1370 queued-after-admission (1085-1087) and
  write-back `recoverWith` (1314-1322), HEL-1374 `guardClock` read only at line 1048. Line count is 1770, not 1751.
- No gate-chain (`.husky/**`) impact.

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; total and related-suite test counts equal the 4db9730fd baseline.
- [C2] Both `ServiceError.Forbidden(` producers stay in `PipelineRunService.scala`; no other file gains one.
- [C3] Moved code logs via the `classOf[PipelineRunService]` logger.
- [C4] Moved bodies are byte-identical apart from D3's listed categories; defects found become follow-ups, not fixes.
- [C5] Synthetic-filtered `javap -public` of `PipelineRunService` (class + companion), `CachedRunStatus`, `TriggerSource` is unchanged.
