package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{RunResultResponse, TruncatedReadResponse}
import com.helio.api.routes.pipelines.RunStatusEvent
import com.helio.domain.model.{AssertionResult, AssertionSink, AuthenticatedUser, DataSource, DataSourceId, Pipeline, PipelineId, PipelineRunId, PipelineStep, PipelineStepKind, TruncationSink, UserId, WriteBackSink}
import com.helio.services.sources.DataSourceService
import com.helio.domain.engine.{NodeKey, NodeOutcome, PipelineExecutionBackend, PipelineRowJson, RootKey, SourceReadStats, StepKey}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.pipelines.{PipelineRunGuardRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory
import spray.json._
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}
import scala.util.control.NonFatal

/** Submit-time run execution: the guard/pre-exec chain, the engine call and the dispatch of its success and
 *  failure outcomes to the terminal collaborators. Split out of `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunExecutor(
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRunRepo: PipelineRunRepository,
    pipelineRunGuardRepo: PipelineRunGuardRepository,
    guardConfig: PipelineRunGuardConfig,
    guardClock: Clock,
    backend: PipelineExecutionBackend,
    support: PipelineRunSupport,
    terminal: PipelineRunTerminalWrites,
    succeeded: PipelineRunSucceededWrites
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
  import support.{resolveAllRootDataSourcesInternal, truncationFields}
  import terminal.{executeRunFailure, onBlockedRun, onDryRunSuccess, onWriteBackFailure, publish}
  import succeeded.onUnblockedRunSuccess

  private[pipelines] def runPipeline(
      pipeline: Pipeline,
      pipelineId: PipelineId,
      isDry: Boolean,
      user: AuthenticatedUser,
      triggerSource: String,
      triggeredByTokenId: Option[String]
  ): Future[Either[ServiceError, RunResultResponse]] =
    // Privileged: pipeline ACL is the authoritative gate; source is part of the
    // pipeline definition. findByIdInternal is correct here.
    // HEL-913 (design.md R4/R9, task 5.4): every root's source is resolved and loaded -- a run
    // is atomic across roots (R9), never partial.
    resolveAllRootDataSourcesInternal(pipelineId).flatMap {
      case roots if roots.isEmpty =>
        Future.successful(Left(ServiceError.UnprocessableEntity(
          "DataSource not found for pipeline: " + pipelineId.value
        )))
      case roots =>
        // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list
        // so editor grantees (not pipeline owners) are not blocked by V35 RLS.
        // HEL-412 (design.md Decision 3, boundaries i/ii): both full runs and
        // dry runs execute the enabled-only step list — a disabled step is
        // dropped as if it were absent. HEL-758: every source kind (including
        // rest_api/sql) now reaches executeRun uniformly — the engine's own
        // loadRows dispatches per-kind, with a null-connector guard for
        // RestSource (design.md D3).
        // HEL-905 (design.md Decision 7): the FULL step list (trunk + tails, disabled steps
        // included) is passed to the engine now -- dropping a disabled mid-trunk/mid-tail step
        // from the vector would orphan its children under a tree (their parentStepId points at a
        // step no longer present). The tree-walk engine itself skips a disabled node in place.
        pipelineStepRepo
          .listByPipelineInternal(pipelineId)
          .flatMap { allSteps =>
            // HEL-1100 design.md Decision 3: the backend is a deployment choice, not a pipeline
            // property -- step CREATION is unaffected either way (PipelineService's own
            // pre-flight is the create-time gate). Rejected at SUBMIT time, before `executeRun`/
            // `backend.execute` ever runs, so a Spark-backed deployment never silently drops an
            // `upsertsource` step's write.
            if (!backend.supportsWriteBack && allSteps.exists(s => s.enabled && s.kind == PipelineStepKind.UpsertSource))
              Future.successful(Left(ServiceError.UnprocessableEntity(
                "The 'upsertsource' step requires the in-process engine"
              )))
            else executeRun(pipeline, roots, allSteps, isDry, user, triggerSource, triggeredByTokenId)
          }
    }

  /** Pre-execute (insert run record + prune) → load source rows → run engine
   *  → publish SSE events → handle success/failure. Extracted from `submit`
   *  to flatten the nested flatMap chain. Behaviour-preserving. */
  private def executeRun(
      pipeline:           Pipeline,
      roots:              Vector[(String, DataSource)],
      steps:              Vector[PipelineStep],
      isDry:              Boolean,
      user:               AuthenticatedUser,
      triggerSource:      String,
      triggeredByTokenId: Option[String] = None
  ): Future[Either[ServiceError, RunResultResponse]] = {
    val pipelineId     = pipeline.id
    val runId          = PipelineRunId(UUID.randomUUID().toString)
    val startAt        = Instant.now()
    val pidStr         = pipelineId.value
    // HEL-509 (419-B): caller-supplied output parameter every `assert` step's
    // evaluated results are recorded into (design.md Decision 4) — constructed
    // here, before the engine call, so a mid-pipeline failure still leaves
    // `assertionSink.results` populated with whatever was evaluated up to
    // that point.
    val assertionSink = new AssertionSink
    // HEL-861 (design D8): caller-supplied output parameter mirroring assertionSink exactly --
    // constructed here, before the engine call, and merged with the primary read's stats below.
    val truncationSink = new TruncationSink
    // HEL-1100 (design.md Decision 2): caller-supplied output parameter every `upsertsource`
    // step's evaluated write is deferred into. Constructed here (mirrors assertionSink/
    // truncationSink) so it's ready before the engine call; only read back below, in the
    // non-dry, not-blocked branch (design.md Decision 3 -- previews/dry runs evaluate but never
    // apply).
    val writeBackSink = new WriteBackSink

    // HEL-1370: `queued` is published below, once the HEL-505 guard has ADMITTED the run -- a
    // guard-rejected (429) submit publishes nothing, so no subscriber is left holding a `queued`
    // that no terminal event will ever follow.

    // HEL-505 (design.md Decision 2, C7): the pipeline-run rate limit is checked FIRST,
    // unconditionally regardless of `isDry` -- the ONLY guard check dry runs are subject to (the
    // concurrency cap below is real-runs-only). `pipelineRunGuardRepo == null` (fixtures that
    // don't pass one) skips the check entirely, mirroring every other nullable-optional
    // collaborator in `PipelineRunService`'s constructor.
    val rateLimitCheck: Future[Either[ServiceError, Unit]] =
      if (pipelineRunGuardRepo != null)
        pipelineRunGuardRepo.incrementRateIfUnderLimit(user.id, guardConfig.rateLimitPerWindow, guardConfig.rateWindowSeconds, guardClock.now()).map {
          case Right(())            => Right(())
          case Left(retryAfterSecs) => Left(ServiceError.TooManyRequests(retryAfterSecs, "Pipeline-run rate limit exceeded"))
        }
      else Future.successful(Right(()))

    rateLimitCheck.flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(()) =>
        // HEL-505 (design.md Decision 3, C1/C2/C7): `insertRunIfUnderConcurrencyCap` REPLACES the
        // plain `insertRun` call for the non-dry path -- dry runs skip this call entirely (already
        // covered by the rate limit above) and proceed straight to `backend.execute`. On `false`
        // (cap reached), `executeRun` returns `Left(TooManyRequests(...))` immediately, WITHOUT
        // ever calling `backend.execute` -- hence `preExec`'s short-circuiting
        // `Future[Either[ServiceError, Unit]]` shape (was `Future[Unit]` pre-HEL-505).
        val preExec: Future[Either[ServiceError, Unit]] =
          if (!isDry && pipelineRunRepo != null)
            pipelineRunRepo
              .insertRunIfUnderConcurrencyCap(runId, pipelineId, startAt, user, triggerSource, triggeredByTokenId, guardConfig.maxConcurrent)
              .flatMap {
                // HEL-505 (skeptic-caught regression during delivery): `NotOwned` mirrors the
                // pre-existing `insertRun` no-op-for-a-non-owner behavior -- an editor-grantee-
                // triggered run has always resolved normally despite no persisted run row, and
                // must keep doing so. Only `CapExceeded` is a real rejection.
                case PipelineRunRepository.ConcurrencyCapResult.Inserted | PipelineRunRepository.ConcurrencyCapResult.NotOwned =>
                  pipelineRunRepo
                    .deleteOldRuns(pipelineId, user, keepN = 10)
                    .recoverWith { case _ => Future.successful(()) }
                    .map(_ => Right(()))
                case PipelineRunRepository.ConcurrencyCapResult.CapExceeded =>
                  Future.successful(Left(ServiceError.TooManyRequests(guardConfig.concurrencyRetryAfterSeconds, "Pipeline-run concurrency limit exceeded")))
              }
          else Future.successful(Right(()))

        preExec.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            // HEL-1370: admitted by the guard (and, for a real run, the `queued` row is committed).
            publish(pidStr, RunStatusEvent("queued", runId = Some(runId.value)))
            publish(pidStr, RunStatusEvent("running", runId = Some(runId.value)))

            // HEL-905 (design.md Decision 6): the tree walk invokes this once per node completed;
            // published as a non-terminal "node-progress" SSE event so the stream stays open across it.
            // HEL-913 R15 (now complete): `nodeKind` is the explicit wire discriminator -- "root" or
            // "step" -- so a consumer never has to already know which ids in this pipeline are roots to
            // interpret `nodeId` correctly.
            def onNodeProgress(key: NodeKey, rowCount: Long): Unit = {
              val (nodeId, nodeKind) = key match {
                case RootKey(rootId) => (rootId, "root")
                case StepKey(stepId) => (stepId, "step")
              }
              publish(pidStr, RunStatusEvent("node-progress", nodeId = Some(nodeId), nodeKind = Some(nodeKind), rowCount = Some(rowCount.toInt), runId = Some(runId.value)))
            }

            val runFuture = backend
              .execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink,
                ownerUserId = Some(pipeline.ownerId.value))
              .map(outcome => (outcome.rows, outcome.stepCounts, outcome.sourceRowCount, outcome.primaryStats, outcome.nodeOutcomes))

            runFuture.transformWith {
              case Failure(ex) =>
                executeRunFailure(pipelineId, runId, pidStr, isDry, user, assertionSink, ex)
              case Success((resultRows, stepCounts, sourceCount, primaryStats, nodeOutcomes)) =>
                executeRunSuccess(
                  pipeline, roots, pipelineId, runId, startAt, pidStr, isDry, user, triggerSource, assertionSink, truncationSink, writeBackSink,
                  resultRows, stepCounts, sourceCount, primaryStats, nodeOutcomes
                )
            }
        }
    }
  }

  /** The `Success(...)` branch of `executeRun`'s original inline `transformWith` (HEL-505:
   *  factored out alongside `executeRunFailure`, unchanged in behavior). */
  private def executeRunSuccess(
      pipeline: Pipeline,
      roots: Vector[(String, DataSource)],
      pipelineId: PipelineId,
      runId: PipelineRunId,
      startAt: Instant,
      pidStr: String,
      isDry: Boolean,
      user: AuthenticatedUser,
      triggerSource: String,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      writeBackSink: WriteBackSink,
      resultRows: Seq[Map[String, Any]],
      stepCounts: Map[String, Long],
      sourceCount: Long,
      primaryStats: SourceReadStats,
      nodeOutcomes: Map[NodeKey, NodeOutcome]
  ): Future[Either[ServiceError, RunResultResponse]] = {
        val jsRows = resultRows.map { rowMap =>
          JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
        }.toVector
        // HEL-369: `runId` was already generated above for insertRun/insertDryRun;
        // surfacing it here is what lets HookTriggerService return it to the
        // external caller (design.md Decision 5).
        // HEL-570: `followUp` also carries the fail-policy's block decision
        // (`None` = not blocked, `Some(summary)` = blocked — design.md
        // Decision 8) so `RunResultResponse.blocked`/`blockedReason` can be
        // populated without a second computation of the summary. A dry run
        // is never blocked (design.md Decision 5), hence the `.map(_ => None)`.
        // HEL-905 (design.md Decision 5): a dry run persists nothing -- it never reaches
        // onUnblockedRunSuccess's per-node writes, only its own (unchanged) history/SSE bookkeeping.
        // HEL-873 (design.md task 2.4): computed BEFORE the success branch (moved up from below)
        // so the persisted write paths -- `onDryRunSuccess`/`onRunSuccess` -- have `truncatedReads`
        // in scope. R10: the lowest-positioned root's stats (`roots.head`, position-ordered by
        // the caller) -- same tiebreak as `TreeWalkResult.rows`/`primaryStats` above.
        val (truncated, availableRowCount, notice, truncatedReads) =
          truncationFields(roots.head._2.name, sourceCount, primaryStats, truncationSink)
        val followUp: Future[Either[ServiceError, Option[String]]] =
          if (isDry) onDryRunSuccess(pipelineId, runId, startAt, pidStr, resultRows.size, user, assertionSink.results, availableRowCount, truncatedReads).map(_ => Right(None))
          else
            onRunSuccess(
              roots.head._2.id, roots.head._1, pipelineId, runId, pidStr, resultRows, jsRows, nodeOutcomes, user, triggerSource,
              assertionSink.results, availableRowCount, truncatedReads, writeBackSink, pipeline.ownerId
            )
        followUp.map {
          case Left(err) => Left(err)
          case Right(blockedSummary) =>
            val response = RunResultResponse(
              jsRows, jsRows.size, stepCounts, sourceCount, runId = Some(runId.value),
              blocked = blockedSummary.isDefined, blockedReason = blockedSummary,
              sourceTruncated = truncated, sourceAvailableRowCount = availableRowCount,
              truncationNotice = notice, truncatedReads = truncatedReads
            )
            Right(response)
        }
  }

  /** HEL-570 (design.md Decisions 1-4, 8): computes `blockingFailures` first
   *  and branches into two paths before any write. When at least one
   *  `error`-severity assertion failed, the run is BLOCKED: only the terminal
   *  status/history writes run (`updateMeta`/`updateRun`/`assertionsInsert`),
   *  and `binaryRefsUpsert`/`alertEvaluation` are skipped entirely so the
   *  prior node snapshot is untouched. Otherwise the existing succeeded path
   *  runs completely unchanged. Returns `None` when not blocked, `Some(summary)`
   *  when blocked — the same summary used for `errorLog`, surfaced to
   *  `executeRun` so `RunResultResponse` can report `blocked`/`blockedReason`
   *  without recomputing it (Decision 8). */
  private def onRunSuccess(
      sourceDataSourceId: DataSourceId,
      lowestRootId:       String,
      pipelineId:         PipelineId,
      runId:              PipelineRunId,
      pidStr:             String,
      resultRows:         Seq[Map[String, Any]],
      jsRows:             Vector[JsObject],
      nodeOutcomes:       Map[NodeKey, NodeOutcome],
      user:               AuthenticatedUser,
      triggerSource:      String,
      assertionResults:   Vector[AssertionResult],
      primaryAvailableRowCount: Option[Long],
      truncatedReads:     Vector[TruncatedReadResponse],
      // HEL-1100 (design.md Decision 3): the deferred write-back sink populated by the just-
      // completed engine run, and the pipeline OWNER's id (D5: writes always run AS the owner,
      // never the triggering caller -- a grantee-triggered or scheduler-fired run still writes
      // under the owner's identity/RLS context).
      writeBackSink:      WriteBackSink,
      pipelineOwnerId:    UserId
  ): Future[Either[ServiceError, Option[String]]] = {
    val blockingFailures = assertionResults.filter(r => r.severity == "error" && !r.passed)
    if (blockingFailures.nonEmpty)
      // HEL-1100 (design.md Decision 3): blocked first -- a blocked run never applies its
      // pending writes at all, matching the pre-existing "no snapshot write on block" contract.
      onBlockedRun(pipelineId, runId, pidStr, user, assertionResults, blockingFailures).map(Right(_))
    else Future.unit.flatMap(_ => applyPendingWriteBacks(writeBackSink, pipelineOwnerId, user)).recoverWith {
      // HEL-1370: a failed (non-IllegalStateException) write-back Future is a run failure too:
      // record it and publish the one terminal `failed`, then re-fail with the original exception
      // (even if that bookkeeping fails) so every `submit` caller sees the outcome it always did.
      case NonFatal(ex) =>
        log.error(s"Pipeline write-back threw for pipeline ${pipelineId.value}, run ${runId.value}", ex)
        onWriteBackFailure(pipelineId, runId, pidStr, user, assertionResults, "Step (upsertsource): write-back failed")
          .transformWith(_ => Future.failed(ex))
    }.flatMap {
      case Left(reason) =>
        val errMsg = s"Step (upsertsource): $reason"
        onWriteBackFailure(pipelineId, runId, pidStr, user, assertionResults, errMsg).map(_ => Left(ServiceError.UnprocessableEntity(errMsg)))
      case Right(()) =>
        onUnblockedRunSuccess(sourceDataSourceId, lowestRootId, pipelineId, runId, pidStr, resultRows, jsRows, nodeOutcomes, user, triggerSource, assertionResults, primaryAvailableRowCount, truncatedReads).map(Right(_))
    }
  }

  /** HEL-1100 (design.md Decision 3): applies every `upsertsource` step's deferred write, as the
   *  pipeline OWNER (D5) -- never the triggering `user`, so a grantee-triggered or
   *  scheduler-fired run still writes under the owner's identity/RLS context. A no-op
   *  (`Right(())`) when nothing was deferred (every pipeline without an `upsertsource` step). */
  private def applyPendingWriteBacks(
      writeBackSink:   WriteBackSink,
      pipelineOwnerId: UserId,
      triggeringUser:  AuthenticatedUser
  ): Future[Either[String, Unit]] = {
    val writes = writeBackSink.writes
    if (writes.isEmpty) Future.successful(Right(()))
    else {
      val ownerUser = AuthenticatedUser(pipelineOwnerId, triggeringUser.source, triggeringUser.tokenId)
      dataSourceRepo.applyWriteBacks(ownerUser, writes, pipelineStepRepo, DataSourceService.DatasetMaxRows)
    }
  }
}
