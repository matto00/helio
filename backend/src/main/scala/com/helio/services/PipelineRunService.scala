package com.helio.services

import com.helio.api.protocols.{
  AssertionFailureDetail,
  AssertionStatusResponse,
  AssertionSummary,
  PipelineRunRecord,
  RunResultResponse
}
import com.helio.api.routes.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.{
  AssertionResult,
  AssertionSink,
  AuthenticatedUser,
  BinaryRef,
  DataField,
  DataSource,
  DataTypeId,
  InProcessPipelineEngine,
  Pipeline,
  PipelineId,
  PipelineRowJson,
  PipelineRunId,
  PipelineStep,
  RestSource,
  SqlSource
}
import com.helio.infrastructure.{
  BinaryRefRepository,
  DataSourceRepository,
  DataTypeRepository,
  DataTypeRowRepository,
  FileSystem,
  PipelineRepository,
  PipelineRunRepository,
  PipelineStepRepository
}
import com.helio.infrastructure.PipelineRunRepository.PipelineRunAssertionRow
import com.helio.spark.PipelineRunCache
import org.slf4j.LoggerFactory
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Service-side run lifecycle. Extracted from the pre-CS2c-3a 380-line
 *  `PipelineRunRoutes` so HTTP routes become thin shells that translate
 *  service results into responses. */
final class PipelineRunService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    pipelineRunRepo:  PipelineRunRepository,
    dataTypeRepo:     DataTypeRepository,
    dataTypeRowRepo:  DataTypeRowRepository,
    cache:            PipelineRunCache,
    registry:         PipelineRunRegistry,
    fileSystem:       FileSystem,
    binaryRefRepo:    BinaryRefRepository = null,
    // HEL-466: nullable default mirrors binaryRefRepo above — fixtures/
    // callers that don't pass an AlertEvaluationService simply skip the
    // post-run evaluation hook in onRunSuccess.
    alertEvaluationService: AlertEvaluationService = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val engine = new InProcessPipelineEngine(fileSystem)

  /** Submit a run (or dry-run) and return its result. Owns pre-execution
   *  (insert run record + prune old runs), source-type dispatch, SSE event
   *  publication, and result fetch + serialization.
   *
   *  HEL-279: sharing-aware. Owner and editor grantees can submit runs;
   *  viewer grantees receive 403 (resource visible, mutation blocked).
   *  The source lookup uses `DataSourceRepository.findByIdInternal` (privileged)
   *  because the pipeline could legitimately reference a join-target source the
   *  caller does not own; the pipeline ACL gated entry.
   *
   *  HEL-417: `triggerSource` defaults to `TriggerSource.Manual` so the
   *  existing manual-API callsite (`PipelineRunSubmitRoutes`) is unaffected;
   *  `PipelineSchedulerService.fire` passes `TriggerSource.Scheduled`
   *  explicitly.
   *
   *  HEL-369: `triggeredByTokenId` defaults to `None` so every existing call
   *  site (`PipelineRunSubmitRoutes`, `PipelineSchedulerService`,
   *  `BoundPanelService`) is unaffected; `HookTriggerService` passes the
   *  scoped-or-unscoped PAT's id explicitly when `POST /api/hooks/run`
   *  authenticated the request. */
  def submit(
      pipelineId: PipelineId,
      isDry: Boolean,
      user: AuthenticatedUser,
      triggerSource: String = TriggerSource.Manual,
      triggeredByTokenId: Option[String] = None
  ): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
        // Grantee — only editor grantees may trigger runs; viewers get 403.
        pipelineRepo.findGrantRole(pipelineId, user).flatMap {
          case Some("editor") => runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
          case _              => Future.successful(Left(ServiceError.Forbidden("Forbidden")))
        }
      case Some(pipeline) =>
        // Owner path — always permitted.
        runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
    }

  private def runPipeline(
      pipeline: Pipeline,
      pipelineId: PipelineId,
      isDry: Boolean,
      user: AuthenticatedUser,
      triggerSource: String,
      triggeredByTokenId: Option[String]
  ): Future[Either[ServiceError, RunResultResponse]] =
    // Privileged: pipeline ACL is the authoritative gate; source is part of the
    // pipeline definition. findByIdInternal is correct here.
    dataSourceRepo.findByIdInternal(pipeline.sourceDataSourceId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.UnprocessableEntity(
          "DataSource not found: " + pipeline.sourceDataSourceId.value
        )))
      case Some(dataSource) =>
        dataSource match {
          case _: RestSource | _: SqlSource =>
            Future.successful(Left(ServiceError.UnprocessableEntity(
              "Unsupported source type for Spark job submission: " +
                dataSource.kind + ". Only static and csv are currently supported."
            )))
          case _ =>
            // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list
            // so editor grantees (not pipeline owners) are not blocked by V35 RLS.
            pipelineStepRepo
              .listByPipelineInternal(pipelineId)
              .flatMap(steps => executeRun(pipeline, dataSource, steps, isDry, user, triggerSource, triggeredByTokenId))
        }
    }

  /** Run only the prefix of `steps` ending at `stepId`, returning at most 10
   *  rows for the inline preview tray.
   *  HEL-279: sharing-aware — owner and grantees can preview. */
  def previewStep(pipelineId: PipelineId, stepId: String, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) =>
        // Privileged: pipeline ACL is the authoritative gate. findByIdInternal is correct here.
        dataSourceRepo.findByIdInternal(pipeline.sourceDataSourceId).flatMap {
          case None =>
            Future.successful(Left(ServiceError.UnprocessableEntity(
              "DataSource not found: " + pipeline.sourceDataSourceId.value
            )))
          case Some(dataSource) =>
            dataSource match {
              case _: RestSource | _: SqlSource =>
                Future.successful(Left(ServiceError.UnprocessableEntity(
                  "Unsupported source type for preview: " +
                    dataSource.kind + ". Only static and csv are currently supported."
                )))
              case _ =>
                // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list.
                pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
                  val sortedSteps = allSteps.sortBy(_.position)
                  sortedSteps.indexWhere(_.id.value == stepId) match {
                    case -1 =>
                      Future.successful(Left(ServiceError.NotFound("Step not found: " + stepId)))
                    case k =>
                      val slicedSteps = sortedSteps.take(k + 1)
                      engine.loadRows(dataSource, dataSourceRepo).flatMap { sourceRows =>
                        engine
                          .executeWithStepCounts(sourceRows, slicedSteps, dataSourceRepo)
                          .map { case (out, counts) =>
                            val allJsRows = out.map { rowMap =>
                              JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
                            }.toVector
                            val totalCount = allJsRows.size
                            val previewRows = allJsRows.take(10)
                            Right(RunResultResponse(previewRows, totalCount, counts, sourceRows.size.toLong))
                          }
                      }.recover { case ex =>
                        // HEL-311: keep the "Pipeline execution failed" prefix, drop
                        // the raw exception tail; log the detail server-side.
                        log.error(s"previewStep failed for pipeline ${pipelineId.value}, step $stepId", ex)
                        Left(ServiceError.UnprocessableEntity("Pipeline execution failed"))
                      }
                  }
                }
            }
        }
    }

  /** Fetch the cached status of a run (queued/running/succeeded/failed). */
  def status(runId: String): Option[CachedRunStatus] =
    cache.get(runId).map { entry =>
      val rowsJson: Option[JsValue] = entry.rows.map { rows =>
        JsArray(rows.map { rowMap =>
          JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
        }.toVector)
      }
      val rowCount: Option[Int] = entry.rows.map(_.size)
      CachedRunStatus(entry.runId, entry.status, rowsJson, entry.error, rowCount)
    }

  /** Persisted run history for a pipeline.
   *  HEL-279: sharing-aware — owner, editor, and viewer grantees can read history.
   *  HEL-576 (design.md Decision 2): each run's `AssertionSummary` is fetched via
   *  one `listAssertionsByRunInternal` call per run, issued concurrently by
   *  `Future.traverse` (not sequentially) -- bounded by the existing ~10 real +
   *  ~10 dry run retention caps (`deleteOldRunsInternal`/`deleteOldDryRunsInternal`),
   *  so at most ~20 concurrent calls per request. Not a scaling risk at that bound;
   *  see design.md's Risks/Trade-offs for why a bulk join isn't warranted here. */
  def history(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineRunRecord]]] =
    if (pipelineRunRepo == null) Future.successful(Right(Vector.empty))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case Some(_) =>
          // Safe: access confirmed by findByIdShared. Use system context to bypass the
          // V35 pipeline_runs RLS owner-JOIN so grantees can read run records.
          pipelineRunRepo.listByPipelineInternal(pipelineId).flatMap { rows =>
            Future.traverse(rows) { r =>
              pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(r.id)).map { assertionRows =>
                PipelineRunRecord(
                  id                 = r.id,
                  pipelineId         = r.pipelineId,
                  status             = r.status,
                  startedAt          = r.startedAt.toString,
                  completedAt        = r.completedAt.map(_.toString),
                  rowCount           = r.rowCount,
                  errorLog           = r.errorLog,
                  triggerSource      = r.triggerSource,
                  triggeredByTokenId = r.triggeredByTokenId.map(_.toString),
                  assertions         = summarizeAssertions(assertionRows)
                )
              }
            }.map(Right(_))
          }
      }

  /** Per-run pass/fail-by-severity summary (design.md Decision 1): `failures`
   *  carries only the FAILED results -- a passing result is just a count. */
  private def summarizeAssertions(rows: Vector[PipelineRunAssertionRow]): AssertionSummary = {
    val failed = rows.filterNot(_.passed)
    AssertionSummary(
      passed      = rows.count(_.passed),
      warnFailed  = failed.count(_.severity == "warn"),
      errorFailed = failed.count(_.severity == "error"),
      failures    = failed.map(r => AssertionFailureDetail(r.kind, r.field, r.severity, r.message))
    )
  }

  /** Composes [[PipelineRunRepository.findLatestRunIdByOutputDataTypeIdInternal]]
   *  with [[PipelineRunRepository.listAssertionsByRunInternal]] (design.md
   *  Decision 6): no latest (non-dry) run means the DataType has never been
   *  written by a real run, so `invalid = false`; otherwise `invalid` is true
   *  when the latest run has at least one persisted error-severity failed
   *  assertion. ACL is enforced by the caller (`DataTypeRoutes`, mirroring
   *  `findLastRunAtByOutputDataTypeId`'s own documented pattern) -- this method
   *  itself is privileged/unchecked. */
  def assertionStatusForDataType(dataTypeId: DataTypeId): Future[AssertionStatusResponse] =
    pipelineRunRepo.findLatestRunIdByOutputDataTypeIdInternal(dataTypeId).flatMap {
      case None =>
        Future.successful(AssertionStatusResponse(dataTypeId.value, invalid = false, failedRuleCount = 0))
      case Some(runId) =>
        pipelineRunRepo.listAssertionsByRunInternal(runId).map { rows =>
          val errorFailures = rows.count(r => r.severity == "error" && !r.passed)
          AssertionStatusResponse(dataTypeId.value, invalid = errorFailures > 0, failedRuleCount = errorFailures)
        }
    }

  /** SSE event stream (delegates to the registry). Routes wrap this into the
   *  `text/event-stream` HTTP response. */
  def eventRegistry: PipelineRunRegistry = registry

  /** Owner-scoped existence check used by the SSE stream guard. */
  def pipelineExists(pipelineId: PipelineId, user: AuthenticatedUser): Future[Boolean] =
    pipelineRepo.findById(pipelineId, user).map(_.isDefined)

  /** Sharing-aware existence check. Returns true for owner AND grantees (editor/viewer).
   *  Used by SSE, run-history, and run-submit routes so viewer grantees can subscribe
   *  and see history. No public-viewer (anonymous) path for pipelines. */
  def pipelineExistsShared(pipelineId: PipelineId, user: AuthenticatedUser): Future[Boolean] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).map(_.isDefined)

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def publish(pipelineId: String, event: RunStatusEvent): Unit =
    if (registry != null) registry.publish(pipelineId, event)

  /** Pre-execute (insert run record + prune) → load source rows → run engine
   *  → publish SSE events → handle success/failure. Extracted from `submit`
   *  to flatten the nested flatMap chain. Behaviour-preserving. */
  private def executeRun(
      pipeline:           Pipeline,
      dataSource:         DataSource,
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

    publish(pidStr, RunStatusEvent("queued"))

    val preExec: Future[Unit] =
      if (!isDry && pipelineRunRepo != null)
        pipelineRunRepo
          .insertRun(runId, pipelineId, startAt, user, triggerSource, triggeredByTokenId)
          .flatMap(_ => pipelineRunRepo.deleteOldRuns(pipelineId, user, keepN = 10))
          .recoverWith { case _ => Future.successful(()) }
      else Future.successful(())

    publish(pidStr, RunStatusEvent("running"))

    val runFuture = preExec.flatMap { _ =>
      engine.loadRows(dataSource, dataSourceRepo).flatMap { sourceRows =>
        engine
          .executeWithStepCounts(sourceRows, steps, dataSourceRepo, assertionSink)
          .map { case (out, counts) => (out, counts, sourceRows.size.toLong) }
      }
    }

    runFuture.transformWith {
      case Failure(ex) =>
        // HEL-311: this single `errMsg` fans out to three client-visible
        // surfaces — the SSE `errorLog` event, `RunStatusResponse.error`,
        // and the persisted `PipelineRunRecord.errorLog` returned by
        // run-history. Genericizing here (keeping the static prefix, logging
        // the raw cause server-side) covers all three at construction.
        log.error(s"Pipeline execution failed for pipeline ${pipelineId.value}, run ${runId.value}", ex)
        val errMsg = "Pipeline execution failed"
        publish(pidStr, RunStatusEvent("failed", errorLog = Some(errMsg)))
        val failWork: Future[Unit] =
          // HEL-509 (419-B, design.md Decision 4): a failed dry run has no
          // `pipeline_runs` row to attach assertion results to (a dry run's
          // row is inserted only on success, see onDryRunSuccess below) — the
          // `insertAssertions` call below MUST stay nested inside this
          // existing `if (!isDry)` guard, never called unconditionally.
          if (!isDry) {
            val updateRun =
              if (pipelineRunRepo != null)
                pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), rowCount = None, errorLog = Some(errMsg), user)
              else Future.successful(())
            updateRun.flatMap { _ =>
              pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None, user)
            }.flatMap { _ =>
              persistAssertions(runId, assertionSink.results)
            }
          } else Future.successful(())
        failWork.map(_ => Left(ServiceError.UnprocessableEntity(errMsg)))

      case Success((resultRows, stepCounts, sourceCount)) =>
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
        val followUp: Future[Option[String]] =
          if (isDry) onDryRunSuccess(pipelineId, runId, startAt, pidStr, resultRows.size, user, assertionSink.results).map(_ => None)
          else onRunSuccess(pipeline.outputDataTypeId, pipelineId, runId, pidStr, resultRows, jsRows, user, assertionSink.results)
        followUp.map { blockedSummary =>
          val response = RunResultResponse(
            jsRows, jsRows.size, stepCounts, sourceCount, runId = Some(runId.value),
            blocked = blockedSummary.isDefined, blockedReason = blockedSummary
          )
          Right(response)
        }
    }
  }

  /** Best-effort persistence of assertion results — wrapped in `recoverWith`
   *  at every call site (design.md Decision 4a), mirroring the file's
   *  existing `insertRun`/`deleteOldRuns` and `insertDryRun`/
   *  `deleteOldDryRuns` best-effort pattern. `insertRun`/`insertDryRun`
   *  already silently no-op for a caller who does not own the parent
   *  pipeline (e.g. an editor grantee triggering a run via
   *  `POST /api/pipelines/:id/run`), leaving no `pipeline_runs` row for
   *  `insertAssertions` to FK against — without this guard, that would turn
   *  today's silent no-op into an unhandled failed `Future`. Skips the call
   *  entirely when there is nothing to persist. */
  private def persistAssertions(runId: PipelineRunId, results: Vector[AssertionResult]): Future[Unit] =
    if (pipelineRunRepo != null && results.nonEmpty)
      pipelineRunRepo.insertAssertions(runId, results).recoverWith { case _ => Future.successful(()) }
    else Future.successful(())

  private def onDryRunSuccess(
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      startAt:          Instant,
      pidStr:           String,
      rowCount:         Int,
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult]
  ): Future[Unit] = {
    publish(pidStr, RunStatusEvent("dry_run", rowCount = Some(rowCount)))
    if (pipelineRunRepo != null)
      pipelineRunRepo
        .insertDryRun(runId, pipelineId, startAt, rowCount, user)
        .flatMap(_ => pipelineRunRepo.deleteOldDryRuns(pipelineId, user))
        .recoverWith { case _ => Future.successful(()) }
        // HEL-509 (419-B, design.md Decision 5): insertAssertions must be
        // sequenced AFTER insertDryRun's own row insert completes — the FK
        // needs the parent `pipeline_runs` row to exist first. This dry run's
        // row is inserted above (unlike the real-run path, where insertRun
        // already ran during preExec).
        .flatMap(_ => persistAssertions(runId, assertionResults))
    else Future.successful(())
  }

  /** HEL-570 (design.md Decisions 1-4, 8): computes `blockingFailures` first
   *  and branches into two paths before any write. When at least one
   *  `error`-severity assertion failed, the run is BLOCKED: only the terminal
   *  status/history writes run (`updateMeta`/`updateRun`/`assertionsInsert`),
   *  and `schemaUpsert`/`rowsUpsert`/`binaryRefsUpsert`/`alertEvaluation` are
   *  skipped entirely so the prior DataType snapshot is untouched. Otherwise
   *  the existing succeeded path runs completely unchanged. Returns `None`
   *  when not blocked, `Some(summary)` when blocked — the same summary used
   *  for `errorLog`, surfaced to `executeRun` so `RunResultResponse` can
   *  report `blocked`/`blockedReason` without recomputing it (Decision 8). */
  private def onRunSuccess(
      outputDataTypeId: DataTypeId,
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      pidStr:           String,
      resultRows:       Seq[Map[String, Any]],
      jsRows:           Vector[JsObject],
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult]
  ): Future[Option[String]] = {
    val blockingFailures = assertionResults.filter(r => r.severity == "error" && !r.passed)
    if (blockingFailures.nonEmpty) onBlockedRun(pipelineId, runId, pidStr, user, assertionResults, blockingFailures)
    else onUnblockedRunSuccess(outputDataTypeId, pipelineId, runId, pidStr, resultRows, jsRows, user, assertionResults)
  }

  /** Blocked branch (design.md Decisions 2-4): terminal status `"failed"`
   *  with a real, structured `errorLog` (not the generic exception-path
   *  placeholder), `rowCount = None` (nothing was written, mirroring the
   *  execution-failure branch's own convention), and the FULL assertion
   *  results vector persisted unconditionally (419-B's existing behavior,
   *  unchanged). The DataType schema/row/binary-ref writes and alert
   *  evaluation are never invoked. */
  private def onBlockedRun(
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      pidStr:           String,
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult],
      blockingFailures: Vector[AssertionResult]
  ): Future[Option[String]] = {
    val summary = summarizeBlockingFailures(blockingFailures)
    publish(pidStr, RunStatusEvent("failed", errorLog = Some(summary)))
    val now = Instant.now()
    val updateMeta = pipelineRepo.updateLastRun(pipelineId, "failed", now, rowCount = None, user).map(_ => ())
    val updateRun =
      if (pipelineRunRepo != null)
        pipelineRunRepo.updateRunTerminal(runId, "failed", now, rowCount = None, errorLog = Some(summary), user).map(_ => ())
      else Future.successful(())
    val assertionsInsert = persistAssertions(runId, assertionResults)
    for {
      _ <- updateMeta
      _ <- updateRun
      _ <- assertionsInsert
    } yield Some(summary)
  }

  /** The pre-existing succeeded path (all-passing or warn-only), unchanged in
   *  behavior — a pure insertion point above this method, not a rewrite. */
  private def onUnblockedRunSuccess(
      outputDataTypeId: DataTypeId,
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      pidStr:           String,
      resultRows:       Seq[Map[String, Any]],
      jsRows:           Vector[JsObject],
      user:             AuthenticatedUser,
      assertionResults: Vector[AssertionResult]
  ): Future[Option[String]] = {
    publish(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size)))
    val now = Instant.now()
    val schemaUpsert =
      if (dataTypeRepo != null) upsertFieldsFromRows(outputDataTypeId, resultRows)
      else Future.successful(())
    val rowsUpsert =
      if (dataTypeRowRepo != null) dataTypeRowRepo.overwriteRows(outputDataTypeId.value, jsRows).map(_ => ())
      else Future.successful(())
    // HEL-216: wire BinaryRefRepository.overwriteForDataType into the one
    // real row-write call site, generically over row shape (not gated on
    // source kind) — see design.md Decision "BinaryRefRepository...wired
    // into PipelineRunService.onRunSuccess". Extracted from resultRows (the
    // post-step, final row values — not the pre-step source rows) so the
    // refs match exactly what jsRows/rowsUpsert just wrote.
    val binaryRefsUpsert =
      if (binaryRefRepo != null)
        binaryRefRepo.overwriteForDataType(outputDataTypeId.value, extractBinaryRefs(outputDataTypeId, resultRows))
      else Future.successful(())
    // HEL-466: fire alert-rule evaluation against the rows just written.
    // Wrapped in recoverWith (matching the file's existing discipline at
    // updateRunTerminal's preExec/insertRun handling) so an evaluation
    // failure is logged inside AlertEvaluationService and never fails or
    // rolls back this run — see design.md "Per-rule isolation"/"Hook
    // placement".
    val alertEvaluation =
      if (alertEvaluationService != null)
        alertEvaluationService
          .evaluateForDataType(outputDataTypeId, resultRows, Some(runId.value))
          .recoverWith { case ex =>
            log.error(s"AlertEvaluationService.evaluateForDataType failed for dataType ${outputDataTypeId.value}, run ${runId.value}", ex)
            Future.successful(())
          }
      else Future.successful(())
    val updateMeta = pipelineRepo.updateLastRun(pipelineId, "succeeded", now, rowCount = Some(resultRows.size.toLong), user).map(_ => ())
    val updateRun =
      if (pipelineRunRepo != null)
        pipelineRunRepo.updateRunTerminal(runId, "succeeded", now, rowCount = Some(resultRows.size), errorLog = None, user).map(_ => ())
      else Future.successful(())
    // HEL-509 (419-B): insertRun already ran during preExec, so the parent
    // `pipeline_runs` row exists before this real-run success path runs —
    // no ordering constraint here (unlike onDryRunSuccess above).
    val assertionsInsert = persistAssertions(runId, assertionResults)
    for {
      _ <- schemaUpsert
      _ <- rowsUpsert
      _ <- binaryRefsUpsert
      _ <- alertEvaluation
      _ <- updateMeta
      _ <- updateRun
      _ <- assertionsInsert
    } yield None
  }

  /** design.md Decision 2: joins each blocking failure's `kind`/`field`/
   *  `message` into one readable line — a real, structured summary (not the
   *  generic exception-path placeholder), used both for `errorLog` and for
   *  `RunResultResponse.blockedReason`. */
  private def summarizeBlockingFailures(failures: Vector[AssertionResult]): String = {
    val details = failures.map { f =>
      val fieldPart = f.field.map(fld => s"($fld)").getOrElse("")
      val messagePart = f.message.getOrElse("assertion failed")
      s"${f.kind}$fieldPart: $messagePart"
    }.mkString("; ")
    s"Run blocked: ${failures.size} error-severity assertion(s) failed — $details"
  }

  /** Extract every `binary-ref`-shaped field value from `rows` into
   *  [[BinaryRef]] records for `binaryRefRepo.overwriteForDataType`
   *  (HEL-217's intended write contract, first wired by HEL-216). Structural,
   *  not schema-driven: a value matches when it's a `Map` carrying all four
   *  required keys with the expected value types — specific enough that a
   *  false-positive match on an unrelated JSON object is very unlikely (see
   *  design.md's Risks/Trade-offs section); a false negative only means a
   *  missing secondary-index entry, non-fatal since `binary_refs` is
   *  explicitly a derived index, never the row read path. */
  private def extractBinaryRefs(dataTypeId: DataTypeId, rows: Seq[Map[String, Any]]): Vector[BinaryRef] = {
    val now = Instant.now()
    rows.zipWithIndex.flatMap { case (row, rowIndex) =>
      row.collect {
        case (fieldName, value: Map[String, Any] @unchecked) if isBinaryRefShape(value) =>
          BinaryRef(
            id         = UUID.randomUUID().toString,
            dataTypeId = dataTypeId.value,
            rowIndex   = rowIndex,
            fieldName  = fieldName,
            storageKey = value("storageKey").asInstanceOf[String],
            mimeType   = value("mimeType").asInstanceOf[String],
            filename   = value("filename").asInstanceOf[String],
            sizeBytes  = value("sizeBytes").asInstanceOf[Long],
            createdAt  = now
          )
      }
    }.toVector
  }

  private def isBinaryRefShape(m: Map[String, Any]): Boolean =
    m.get("storageKey").exists(_.isInstanceOf[String]) &&
      m.get("mimeType").exists(_.isInstanceOf[String]) &&
      m.get("filename").exists(_.isInstanceOf[String]) &&
      m.get("sizeBytes").exists(_.isInstanceOf[Long])

  // Infer field type strings from row values. Whole-number Doubles → "integer",
  // fractional Doubles → "double" (jsValueToAny always produces Double).
  private def inferFieldType(value: Any): String = value match {
    case _: Boolean => "boolean"
    case _: Int | _: Long => "integer"
    case d: Double if !d.isNaN && !d.isInfinite && d % 1.0 == 0.0 => "integer"
    case _: Float | _: Double => "double"
    case _ => "string"
  }

  private def upsertFieldsFromRows(
      dataTypeId: DataTypeId,
      rows:       Seq[Map[String, Any]]
  ): Future[Unit] = {
    if (dataTypeRepo == null) return Future.successful(())
    val firstRow = rows.headOption.getOrElse(Map.empty)
    val fields = firstRow.keys.toVector.map { name =>
      DataField(name, name, inferFieldType(firstRow.get(name).orNull), nullable = true)
    }
    // Privileged: this is a background post-run schema sync. The pipeline ACL
    // was the gate at submission time; no user context is available here.
    // Uses updateInternal (withSystemContext) to bypass the V35 RLS policy on
    // data_types — correct because this path runs without a request-bound user.
    dataTypeRepo.findByIdInternal(dataTypeId).flatMap {
      case None => Future.successful(())
      case Some(existing) =>
        dataTypeRepo.updateInternal(existing.copy(fields = fields, updatedAt = Instant.now())).map(_ => ())
    }
  }

}

/** Service-side projection of a cached run's status. Translated by routes
 *  into the `RunStatusResponse` wire shape. */
final case class CachedRunStatus(
    runId:    String,
    status:   String,
    rows:     Option[JsValue],
    error:    Option[String],
    rowCount: Option[Int]
)

/** The three `pipeline_runs.trigger_source` literals (HEL-417). Modeled as a
 *  plain-`String` constants holder rather than a sealed domain type — mirrors
 *  the existing bare-`String` convention `PipelineRunRow`/`PipelineRunRecord`
 *  already use for `status` (see design.md Decision 1). `External` is
 *  reserved for HEL-369; no caller passes it yet. */
object TriggerSource {
  val Manual: String    = "manual"
  val Scheduled: String = "scheduled"
  val External: String  = "external"
}
