package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.alerts.AlertEvaluationService
import com.helio.services.audit.AuditService
import com.helio.api.protocols.pipelines.{AssertionFailureDetail, AssertionStatusResponse, AssertionSummary, PipelineRunRecord, RunResultResponse, TruncatedReadResponse}
import com.helio.api.routes.pipelines.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.model.{AssertionResult, AssertionSink, AuditSource, AuthenticatedUser, BinaryRef, DataField, DataFieldType, DataSource, DataSourceId, DataTypeId, Pipeline, PipelineId, PipelineRunId, PipelineStep, TruncatedRead, TruncationSink}
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, PipelineAnalyzeService, PipelineExecutionBackend, PipelineRowJson, SchemaField, SchemaInferenceEngine, SourceReadStats, StepExecutionException}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.services.sources.{ContentSourceSupport, CsvUrlFetch}
import org.apache.pekko.actor.typed.ActorSystem
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, DataTypeRepository, DataTypeRowRepository, NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository.PipelineRunAssertionRow
import com.helio.spark.PipelineRunCache
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.net.InetAddress
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

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
    alertEvaluationService: AlertEvaluationService = null,
    // HEL-758 (design.md D3): nullable default mirrors binaryRefRepo/
    // alertEvaluationService above — threaded through to InProcessPipelineEngine
    // so it can execute a RestSource. A null connector fails fast inside the
    // engine's RestSource loadRows case rather than here; SqlSource needs no
    // such threading (SqlConnectorDriver is a stateless object).
    connector: RestApiConnectorDriver = null,
    // HEL-477: nullable-optional wiring mirrors connector above.
    auditService: AuditService = null,
    // HEL-862 (design.md Decision 3): nullable/defaulted convention mirrors
    // binaryRefRepo/alertEvaluationService/connector/auditService above.
    // `system` MUST NOT be dereferenced at construction time — it is `null`
    // in every fixture above that omits it, and `engine` (below) is an
    // eagerly-initialised field, so the csvUrlFetch closure passed to it
    // resolves `system` LAZILY, at call time, inside the closure body.
    system: ActorSystem[_] = null,
    resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr),
    // HEL-330 (design.md Decision 3): nullable-default convention mirrors binaryRefRepo/
    // alertEvaluationService/connector/auditService above. A default of
    // `new InProcessExecutionBackend(engine)` cannot compile as a constructor default (`engine`
    // is an instance field, out of scope in a synthesized static default-argument method) --
    // resolved to the `backend` field below instead.
    executionBackend: PipelineExecutionBackend = null,
    // HEL-904 (task 3.1/3.14): nullable-default convention mirrors
    // binaryRefRepo/alertEvaluationService above. `outputRepo` resolves the
    // Outputs attached to a pipeline's trunk-last node so alert evaluation
    // runs `evaluateForOutput` per Output instead of the retired
    // `evaluateForDataType`; `nodeSnapshotRepo` writes `node_snapshots`
    // keyed by that same node, alongside the still-live `dataTypeRowRepo`
    // write (both tables/routes stay live until section 4 deletes the old
    // ones — see design.md decision 1e).
    outputRepo: OutputRepository = null,
    nodeSnapshotRepo: NodeSnapshotRepository = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-862 design.md Decision 3/task 6.7: a thin closure over
   *  `CsvUrlFetch.fetch` — NOT a second implementation of its checks. `system`
   *  is read INSIDE the closure (call time), never at this val's own
   *  construction, so a fixture that never runs a URL-backed CSV never pays
   *  for (or NPEs on) a null `system`. */
  private def csvUrlFetchSeam(url: String): Future[Either[String, Array[Byte]]] =
    if (system == null)
      Future.successful(Left("URL-backed CSV fetch is not configured"))
    else
      CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost, isBlocked)(system)
        .map(_.left.map(_.message))

  private val engine = new InProcessPipelineEngine(fileSystem, connector, csvUrlFetchSeam)

  // HEL-330 (design.md Decision 3): the two execution call sites (`executeRun`, `previewStep`)
  // depend on this trait reference, not `engine` directly.
  private val backend: PipelineExecutionBackend =
    if (executionBackend != null) executionBackend else new InProcessExecutionBackend(engine)

  /** HEL-861 (design D4): the run-wide truncation fields, computed once from the primary
   *  source's own [[SourceReadStats]] plus any secondary-source truncated reads recorded in
   *  `sink` (design D8 -- `join`/`union`/`lookup` re-entries). Deduped by data-source name
   *  (task 3.1a) so two steps reading the same truncated secondary source produce one entry and
   *  the notice names it once. Returns `(sourceTruncated, sourceAvailableRowCount, notice,
   *  truncatedReads)`. */
  private def truncationFields(
      primaryName: String,
      primaryRowsRead: Long,
      primaryStats: SourceReadStats,
      sink: TruncationSink
  ): (Boolean, Option[Long], Option[String], Vector[TruncatedReadResponse]) = {
    val primaryRead =
      if (primaryStats.truncated) Vector(TruncatedRead(primaryName, primaryRowsRead, primaryStats.availableRowCount))
      else Vector.empty
    // Task 3.1a dedupe MUST be order-preserving, primary first — `groupBy(...).values` returns
    // hash-ordered results, which would let a multi-source notice name its sources in a different
    // order between two identical runs. A fold-based distinct keeps first-seen order instead.
    val allReads = (primaryRead ++ sink.reads).foldLeft(Vector.empty[TruncatedRead]) { (acc, read) =>
      if (acc.exists(_.dataSourceName == read.dataSourceName)) acc else acc :+ read
    }
    val notice = PipelineRunService.composeTruncationNotice(allReads, InProcessPipelineEngine.MaxRunRows)
    (
      allReads.nonEmpty,
      primaryStats.availableRowCount,
      notice,
      allReads.map(r => TruncatedReadResponse(r.dataSourceName, r.rowsRead, r.availableRowCount))
    )
  }

  /** HEL-477 design.md Decision 5: only run *submission* is audited, not
   *  every internal status transition — fired once, from `submit` itself,
   *  regardless of whether the run subsequently succeeds/fails/blocks. */
  private def auditSubmit(pipelineId: PipelineId, user: AuthenticatedUser, isDry: Boolean): Unit =
    if (auditService != null && !isDry)
      auditService.record(Some(user.id), user.tokenId, user.source, "pipeline.run.submit", "pipeline", Some(pipelineId.value), JsObject.empty)

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
          case Some("editor") =>
            auditSubmit(pipelineId, user, isDry)
            runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
          case _              => Future.successful(Left(ServiceError.Forbidden("Forbidden")))
        }
      case Some(pipeline) =>
        // Owner path — always permitted.
        auditSubmit(pipelineId, user, isDry)
        runPipeline(pipeline, pipelineId, isDry, user, triggerSource, triggeredByTokenId)
    }

  /** Persist a "never attempted" run for a pipeline whose resolved source
   *  kind the execution engine can't run at all (`rest_api`/`sql` —
   *  [[PipelineRunService.SparkUnsupportedKinds]], design.md D2/D3 of
   *  HEL-755). Reached from `PipelineProposalService.createPipeline` when it
   *  skips [[submit]] entirely rather than reaching [[runPipeline]]'s
   *  Spark-submission rejection. Mirrors `onBlockedRun`'s persistence
   *  pattern below — best-effort `insertRun`, then `updateRunTerminal`/
   *  `pipelineRepo.updateLastRun`, both terminal status `"failed"` — so the
   *  reason is durable: it survives a page reload via the pipeline's
   *  `lastRunStatus` badge and its run history, not just the transient apply
   *  response. */
  def recordUnrunnable(pipelineId: PipelineId, reason: String, user: AuthenticatedUser): Future[RunResultResponse] = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    val now   = Instant.now()
    val insertWork: Future[Unit] =
      if (pipelineRunRepo != null)
        pipelineRunRepo.insertRun(runId, pipelineId, now, user).recoverWith { case _ => Future.successful(()) }
      else Future.successful(())
    insertWork
      .flatMap { _ =>
        if (pipelineRunRepo != null)
          pipelineRunRepo.updateRunTerminal(runId, "failed", now, rowCount = None, errorLog = Some(reason), user)
        else Future.successful(())
      }
      .flatMap { _ => pipelineRepo.updateLastRun(pipelineId, "failed", now, rowCount = None, user) }
      .map { _ =>
        // HEL-861 (design D4/task 3.5): no source read occurred here -- the run was never
        // attempted -- so leaving sourceTruncated/etc. on their defaulted `false`/`None` is
        // factually correct, not an oversight.
        RunResultResponse(
          rows = Vector.empty, rowCount = 0, runId = Some(runId.value), blocked = true, blockedReason = Some(reason)
        )
      }
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
        // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list
        // so editor grantees (not pipeline owners) are not blocked by V35 RLS.
        // HEL-412 (design.md Decision 3, boundaries i/ii): both full runs and
        // dry runs execute the enabled-only step list — a disabled step is
        // dropped as if it were absent. HEL-758: every source kind (including
        // rest_api/sql) now reaches executeRun uniformly — the engine's own
        // loadRows dispatches per-kind, with a null-connector guard for
        // RestSource (design.md D3).
        pipelineStepRepo
          .listByPipelineInternal(pipelineId)
          .flatMap(allSteps => executeRun(pipeline, dataSource, allSteps.filter(_.enabled), isDry, user, triggerSource, triggeredByTokenId))
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
            // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list.
            // HEL-758: every source kind (including rest_api/sql) now reaches
            // this preview path uniformly (design.md D3).
            pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
              val sortedSteps = allSteps.sortBy(_.position)
              sortedSteps.indexWhere(_.id.value == stepId) match {
                case -1 =>
                  Future.successful(Left(ServiceError.NotFound("Step not found: " + stepId)))
                // HEL-412 (design.md Decision 3, boundary "previewStep"): previewing
                // a disabled step itself is rejected — the UI never offers this
                // (disabled cards hide their preview control), so this is a
                // defensive backstop.
                case k if !sortedSteps(k).enabled =>
                  Future.successful(Left(ServiceError.UnprocessableEntity("step is disabled")))
                case k =>
                  // Disabled steps are excluded from the executed prefix — the
                  // preview reflects the pipeline as it would actually run.
                  val slicedSteps = sortedSteps.take(k + 1).filter(_.enabled)
                  // HEL-861 (design D8/task 2.2c): the step-preview site is the one call site
                  // design.md calls out by name -- it must construct and pass its OWN
                  // truncationSink here, mirroring the real-run site, or a preview whose
                  // union/join/lookup reads a truncated secondary source would silently report
                  // sourceTruncated: false. Verified by test 7.6c.
                  val truncationSink = new TruncationSink
                  // HEL-330 (design.md Decision 3): `previewStep` previously relied on
                  // `executeWithStepCounts`'s own defaulted `assertionSink`, which the trait's
                  // non-optional parameter no longer supplies for free -- a fresh, discarded
                  // sink here preserves that behavior exactly, without sharing state with the
                  // run path's sink.
                  backend
                    .execute(pipeline, dataSource, slicedSteps.toVector, dataSourceRepo, new AssertionSink, truncationSink)
                    .map { outcome =>
                      val allJsRows = outcome.rows.map { rowMap =>
                        JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
                      }.toVector
                      val totalCount  = allJsRows.size
                      val previewRows = allJsRows.take(10)
                      val (truncated, availableRowCount, notice, truncatedReads) =
                        truncationFields(dataSource.name, outcome.sourceRowCount, outcome.primaryStats, truncationSink)
                      Right(RunResultResponse(
                        previewRows, totalCount, outcome.stepCounts, outcome.sourceRowCount,
                        sourceTruncated = truncated, sourceAvailableRowCount = availableRowCount,
                        truncationNotice = notice, truncatedReads = truncatedReads
                      ))
                    }.recover { case ex =>
                    // HEL-311: keep the "Pipeline execution failed" prefix, drop
                    // the raw exception tail; log the detail server-side.
                    // HEL-859 (design.md Decision 3): forward the attributed
                    // step id/kind/reason when available, same as run's failure path.
                    log.error(s"previewStep failed for pipeline ${pipelineId.value}, step $stepId", ex)
                    val errMsg = ex match {
                      case see: StepExecutionException => see.getMessage
                      case _                            => "Pipeline execution failed"
                    }
                    Left(ServiceError.UnprocessableEntity(errMsg))
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
    // HEL-861 (design D8): caller-supplied output parameter mirroring assertionSink exactly --
    // constructed here, before the engine call, and merged with the primary read's stats below.
    val truncationSink = new TruncationSink

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
      backend
        .execute(pipeline, dataSource, steps, dataSourceRepo, assertionSink, truncationSink)
        .map(outcome => (outcome.rows, outcome.stepCounts, outcome.sourceRowCount, outcome.primaryStats))
    }

    runFuture.transformWith {
      case Failure(ex) =>
        // HEL-311: this single `errMsg` fans out to three client-visible
        // surfaces — the SSE `errorLog` event, `RunStatusResponse.error`,
        // and the persisted `PipelineRunRecord.errorLog` returned by
        // run-history. Genericizing here (keeping the static prefix, logging
        // the raw cause server-side) covers all three at construction.
        log.error(s"Pipeline execution failed for pipeline ${pipelineId.value}, run ${runId.value}", ex)
        // HEL-859 (design.md Decision 3, Decision 3a): when the failure was
        // attributed to a specific step by the in-process engine, forward its
        // curated message (id, kind, allowlisted reason); the Spark path
        // (out of scope) never produces a StepExecutionException, so it still
        // falls through to the generic constant.
        val errMsg = ex match {
          case see: StepExecutionException => see.getMessage
          case _                           => "Pipeline execution failed"
        }
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

      case Success((resultRows, stepCounts, sourceCount, primaryStats)) =>
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
          else onRunSuccess(pipeline.outputDataTypeId, pipeline.sourceDataSourceId, pipelineId, runId, pidStr, resultRows, jsRows, user, assertionSink.results)
        val (truncated, availableRowCount, notice, truncatedReads) =
          truncationFields(dataSource.name, sourceCount, primaryStats, truncationSink)
        followUp.map { blockedSummary =>
          val response = RunResultResponse(
            jsRows, jsRows.size, stepCounts, sourceCount, runId = Some(runId.value),
            blocked = blockedSummary.isDefined, blockedReason = blockedSummary,
            sourceTruncated = truncated, sourceAvailableRowCount = availableRowCount,
            truncationNotice = notice, truncatedReads = truncatedReads
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
      outputDataTypeId:   DataTypeId,
      sourceDataSourceId: DataSourceId,
      pipelineId:         PipelineId,
      runId:              PipelineRunId,
      pidStr:             String,
      resultRows:         Seq[Map[String, Any]],
      jsRows:             Vector[JsObject],
      user:               AuthenticatedUser,
      assertionResults:   Vector[AssertionResult]
  ): Future[Option[String]] = {
    val blockingFailures = assertionResults.filter(r => r.severity == "error" && !r.passed)
    if (blockingFailures.nonEmpty) onBlockedRun(pipelineId, runId, pidStr, user, assertionResults, blockingFailures)
    else onUnblockedRunSuccess(outputDataTypeId, sourceDataSourceId, pipelineId, runId, pidStr, resultRows, jsRows, user, assertionResults)
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
      outputDataTypeId:   DataTypeId,
      sourceDataSourceId: DataSourceId,
      pipelineId:         PipelineId,
      runId:              PipelineRunId,
      pidStr:             String,
      resultRows:         Seq[Map[String, Any]],
      jsRows:             Vector[JsObject],
      user:               AuthenticatedUser,
      assertionResults:   Vector[AssertionResult]
  ): Future[Option[String]] = {
    publish(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size)))
    val now = Instant.now()
    // HEL-891 design D1: derive the schema from `jsRows` -- the SAME value `rowsUpsert` below
    // hands to `overwriteRows` -- so the schema can never describe rows other than the ones
    // actually persisted.
    val schemaUpsert =
      if (dataTypeRepo != null) upsertFieldsFromRows(outputDataTypeId, jsRows)
      else Future.successful(())
    val rowsUpsert =
      if (dataTypeRowRepo != null) dataTypeRowRepo.overwriteRows(outputDataTypeId.value, jsRows).map(_ => ())
      else Future.successful(())
    // HEL-904 (task 3.14): dual-write `node_snapshots`, keyed by this
    // pipeline's trunk-last step (the sole node the pre-tree-walk engine
    // ever materializes — see P1.2/HEL-905 for the real per-node write).
    // Additive alongside `dataTypeRowRepo` above; both stay live until
    // section 4 deletes `data_type_rows`/`GET /api/types/:id/rows`.
    val nodeSnapshotUpsert =
      if (nodeSnapshotRepo != null)
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { steps =>
          val trunkLastStepId = pipelineStepRepo.trunkOf(steps).lastOption.map(_.id)
          nodeSnapshotRepo.overwriteRows(pipelineId.value, trunkLastStepId.map(_.value), jsRows)
        }
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
    // HEL-904 (task 3.1): evaluate per Output of every materialized node —
    // today that's just this pipeline's Outputs (the pre-tree-walk engine
    // only ever materializes one node; see P1.2/HEL-905 for the real
    // per-node walk). Each Output's evaluation is independently isolated
    // (mirrors AlertEvaluationService's own per-rule isolation) so one
    // Output's failure never blocks a sibling Output on the same pipeline.
    val alertEvaluation =
      if (alertEvaluationService != null && outputRepo != null)
        outputRepo.listByPipelineInternal(pipelineId).flatMap { outputs =>
          Future
            .sequence(outputs.map { output =>
              alertEvaluationService
                .evaluateForOutput(output.id, resultRows, Some(runId.value))
                .recoverWith { case ex =>
                  log.error(s"AlertEvaluationService.evaluateForOutput failed for output ${output.id.value}, run ${runId.value}", ex)
                  Future.successful(())
                }
            })
            .map(_ => ())
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
    // HEL-462 (design D4): best-effort schema-drift baseline capture — the
    // current source schema (same derivation `PipelineService.analyze` uses)
    // becomes the new `last_source_schema` baseline. Only real, non-dry
    // successes reach this method (`onDryRunSuccess` never calls it), which
    // is exactly "a successful run" in the ticket's sense. `recoverWith`
    // ensures a resolution/write failure here never fails or blocks the run.
    val baselineUpsert: Future[Unit] =
      if (dataTypeRepo != null)
        dataTypeRepo.findBySourceId(sourceDataSourceId, user.id)
          .map(PipelineAnalyzeService.deriveSourceSchema)
          .flatMap { schema: Vector[SchemaField] =>
            pipelineRepo.updateLastSourceSchema(pipelineId, schema.toJson.compactPrint, user)
          }
          .recoverWith { case ex =>
            log.warn(s"HEL-462: schema-drift baseline capture failed for pipeline ${pipelineId.value}", ex)
            Future.successful(())
          }
      else Future.successful(())
    for {
      _ <- schemaUpsert
      _ <- rowsUpsert
      _ <- nodeSnapshotUpsert
      _ <- binaryRefsUpsert
      _ <- alertEvaluation
      _ <- updateMeta
      _ <- updateRun
      _ <- assertionsInsert
      _ <- baselineUpsert
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

  private def upsertFieldsFromRows(
      dataTypeId: DataTypeId,
      jsRows:     Vector[JsObject]
  ): Future[Unit] = {
    if (dataTypeRepo == null) return Future.successful(())
    // HEL-891 design D2: union top-level keys and widen types across ALL rows via the shared
    // shallow entry point -- NOT `inferSchemaFromRows`/`inferFromObjects`, which flatten each
    // object through `JsonFlattener.leaves` first. Flattening would describe dotted keys the
    // stored rows (written un-flattened by `overwriteRows`) do not have.
    val inferred = SchemaInferenceEngine.inferShallowFromJsObjects(jsRows)
    val fields = inferred.map { f =>
      DataField(
        name        = f.name,
        // HEL-891 design D7: displayName stays the RAW column name, discarding the engine's
        // title-cased `displayName` -- pipeline-output columns are user-chosen (rename/select
        // step), so echo them verbatim rather than adopting third-party-API-style prettification.
        displayName = f.name,
        dataType    = DataFieldType.asString(f.dataType),
        // HEL-891 design D3: nullable is pinned `true` here, discarding the engine's
        // absence-never-contributes nullable. Rows are sparse maps and any column may be absent
        // from any given row -- adopting the shared engine's rule would land HEL-868's bug
        // ("a column present on 166/200 rows advertised non-nullable") on a path that does not
        // have it today. Revisit this pin once HEL-868 lands.
        nullable    = true
      )
    }.toVector
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

/** HEL-755 design.md D2: single source of truth for the source kinds the
 *  execution engine categorically can't run at all — `PipelineProposalService.
 *  createPipeline` consults this set to route to `recordUnrunnable` (a
 *  durable "blocked" run) instead of `submit`, without duplicating a kind
 *  list as a third copy.
 *
 *  HEL-758 (design.md D4): empty now that `rest_api`/`sql` both execute via
 *  `InProcessPipelineEngine.loadRows` (`runPipeline`/`previewStep` no longer
 *  hardcode a rejection for either kind). Left in place, not deleted, as a
 *  forward-looking extension point for a future source kind the engine
 *  categorically can't run (e.g. a streaming source) — `recordUnrunnable` and
 *  `PipelineProposalService`'s guard branch stay wired to this set so a new
 *  unrunnable kind needs only a one-line addition here, no new plumbing. */
object PipelineRunService {
  val SparkUnsupportedKinds: Set[String] = Set.empty[String]

  private val truncationConsequenceSentence: String =
    "Results computed from this run — including any filter, sort, or aggregate — describe only " +
      "that partial population, not the full source."

  /** One truncated source's clause, per design.md Decision 4's exact wording (both branches). */
  private def truncationReadClause(read: TruncatedRead, cap: Int): String =
    read.availableRowCount match {
      case Some(available) =>
        s"""Source "${read.dataSourceName}" truncated: this run read the first ${read.rowsRead} """ +
          s"""rows returned, out of $available available, because of the $cap-row run cap."""
      case None =>
        s"""Source "${read.dataSourceName}" truncated: this run read the first ${read.rowsRead} """ +
          s"""rows returned because of the $cap-row run cap, and more rows exist (the total is not known)."""
    }

  /** HEL-861 (design D4/task 3.2): the ONE server-side notice composer, so the API, MCP, and UI
   *  surfaces all read the identical, already-correct sentence rather than each composing their
   *  own wording that could drift. `None` when nothing was truncated. When more than one source
   *  was truncated, each is named with its own read/available counts, followed once by the
   *  shared consequence sentence. */
  def composeTruncationNotice(reads: Vector[TruncatedRead], cap: Int): Option[String] =
    if (reads.isEmpty) None
    else Some((reads.map(truncationReadClause(_, cap)) :+ truncationConsequenceSentence).mkString(" "))
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
