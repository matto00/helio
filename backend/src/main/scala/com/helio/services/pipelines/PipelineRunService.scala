package com.helio.services.pipelines

import com.helio.domain.ai.AiStepClient
import com.helio.services.ServiceError
import com.helio.services.alerts.AlertEvaluationService
import com.helio.services.audit.AuditService
import com.helio.api.protocols.pipelines.{LatestRunResponse, PipelinePreviewResponse, PipelineRunRecord, RunResultResponse}
import com.helio.api.routes.pipelines.PipelineRunRegistry
import com.helio.domain.model.{AuthenticatedUser, OutputId, PipelineId, PipelineRootId, PipelineRunId, PipelineStepId, TruncatedRead}
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, PipelineExecutionBackend}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.util.{Clock, SystemClock}
import com.helio.services.sources.{ContentSourceSupport, CsvUrlFetch}
import org.apache.pekko.actor.typed.ActorSystem
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, NodeSnapshotRepository, NodePayloadHistoryRepository, OutputHistoryRepository, OutputRepository, PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import com.helio.spark.PipelineRunCache
import org.slf4j.LoggerFactory
import spray.json._
import java.net.InetAddress
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Service-side run lifecycle. Extracted from the pre-CS2c-3a 380-line
 *  `PipelineRunRoutes` so HTTP routes become thin shells that translate
 *  service results into responses. */
final class PipelineRunService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    pipelineRunRepo:  PipelineRunRepository,
    cache:            PipelineRunCache,
    registry:         PipelineRunRegistry,
    fileSystem:       FileSystem,
    binaryRefRepo:    BinaryRefRepository = null,
    // HEL-466: nullable default mirrors binaryRefRepo above — fixtures/
    // callers that don't pass an AlertEvaluationService simply skip the
    // post-run evaluation hook in `PipelineRunSucceededWrites.onUnblockedRunSuccess`.
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
    // HEL-904 (task 3.1/3.14). `outputRepo` (HEL-1295: required, never null -- enforced by the
    // `require` in the class body) resolves the
    // Outputs attached to a pipeline's trunk-last node so alert evaluation
    // runs `evaluateForOutput` per Output instead of the retired
    // `evaluateForDataType`; `nodeSnapshotRepo` writes `node_snapshots`
    // keyed by that same node — the sole row-materialization write now that
    // task 4.1 has removed the legacy `data_type_rows` write alongside it.
    outputRepo: OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository = null,
    // HEL-1271 (design.md D-4): nullable-default convention mirrors nodeSnapshotRepo. When set, each
    // materialized node's per-Output history point is inserted in that node's own snapshot
    // transaction; when null, the snapshot write is the unchanged history-free `overwriteRows`.
    outputHistoryRepo: OutputHistoryRepository = null,
    // HEL-1276: nullable-default convention mirrors outputHistoryRepo; only consulted inside the
    // history branch of `PipelineRunSucceededWrites`, so a fixture without a payload repo writes summaries exactly as before.
    nodePayloadRepo: NodePayloadHistoryRepository = null,
    payloadConfig: PayloadHistoryConfig = PayloadHistoryConfig.Defaults,
    // HEL-1106 (design.md D2): nullable-default convention mirrors binaryRefRepo/
    // alertEvaluationService above -- threaded through to InProcessPipelineEngine so an
    // `analyzewithai` step can call the model. Defaults to AiStepClient.Unavailable so every
    // fixture that omits it degrades to the named `ai-unavailable` run failure rather than an NPE.
    aiStepClient: AiStepClient = AiStepClient.Unavailable,
    // HEL-505 (design.md Decisions 1/2): nullable-default convention mirrors alertEvaluationService
    // above -- fixtures that don't pass a PipelineRunGuardRepository simply skip the
    // rate-limit check in `PipelineRunExecutor.executeRun` (guard off, matching every other nullable-optional
    // collaborator's fixture behavior in this constructor).
    pipelineRunGuardRepo: PipelineRunGuardRepository = null,
    // HEL-505: NOT nullable, unlike pipelineRunGuardRepo above -- `guardConfig.maxConcurrent` is
    // read by the CONCURRENCY CAP (3.2), which is gated on `pipelineRunRepo != null` alone (the
    // SAME collaborator every pre-existing fixture with a real repo already passes), not on
    // `pipelineRunGuardRepo`. Defaults to `PipelineRunGuardConfig.fromEnv()`'s conservative
    // production values (mirrors `RateLimitConfig`'s fromEnv-once-inject-explicitly convention) so
    // a fixture that constructs this service with a real `pipelineRunRepo` but no explicit config
    // still gets a real (non-zero) cap rather than an NPE.
    guardConfig: PipelineRunGuardConfig = PipelineRunGuardConfig.fromEnv(),
    // HEL-1374: drives ONLY the rate-window bucket (`incrementRateIfUnderLimit`'s `now`) -- no
    // other timestamp in this service reads it. Production keeps `SystemClock`, identical to the
    // repository's own `Instant.now()` default; tests pin it so a case spanning a wall-clock
    // window boundary cannot straddle two epoch-aligned rate buckets.
    guardClock: Clock = SystemClock
)(implicit ec: ExecutionContext) {

  require(outputRepo != null, "PipelineRunService requires an OutputRepository")

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-862/HEL-881 (design.md Decision 2/3, task 2.2): the single seam the
   *  engine calls for EVERY URL-backed source kind — a thin closure that
   *  dispatches by `kind` to `CsvUrlFetch.fetch` (csv keeps its https-only +
   *  non-CSV-body gate) or `ContentSourceSupport.fetchUrlWithLimit`
   *  (text/pdf/image stay http-or-https, per Decision 3), NOT a second
   *  implementation of either's checks. `system` is read INSIDE the closure
   *  (call time), never at this val's own construction, so a fixture that
   *  never runs a URL-backed source never pays for (or NPEs on) a null
   *  `system`. */
  private def urlFetchSeam(kind: String, url: String): Future[Either[String, Array[Byte]]] =
    if (system == null)
      Future.successful(Left("URL-backed source fetch is not configured"))
    else
      kind match {
        case "csv" =>
          CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost, isBlocked)(system)
            .map(_.left.map(_.message))
        case "text"  => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.textMaxBytes, resolveHost, isBlocked)(system)
        case "pdf"   => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.pdfMaxBytes, resolveHost, isBlocked)(system)
        case "image" => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.imageMaxBytes, resolveHost, isBlocked)(system)
        case other   => Future.successful(Left(s"URL-backed fetch is not supported for source kind '$other'"))
      }

  // HEL-952 design.md Decision 4a: reuses the SAME resolveHost/isBlocked this class already
  // takes for URL-backed sources — one override per ApiRoutes construction, not a second,
  // independently-drifting SQL-specific pair.
  private val engine = new InProcessPipelineEngine(fileSystem, connector, urlFetchSeam, resolveHost, isBlocked, aiStepClient)

  // HEL-330 (design.md Decision 3): the execution call sites (`PipelineRunExecutor.executeRun`,
  // `PipelineRunPreview.previewStep`/`previewAtNode`, `PipelineRunBackfill`) depend on this trait
  // reference, not `engine` directly.
  private val backend: PipelineExecutionBackend =
    if (executionBackend != null) executionBackend else new InProcessExecutionBackend(engine, pipelineStepRepo)

  // HEL-1371: concern-focused collaborators, built after `backend` (eagerly initialised) and in dependency order.
  private val support   = new PipelineRunSupport(pipelineRepo, dataSourceRepo)
  private val terminal  = new PipelineRunTerminalWrites(pipelineRepo, pipelineRunRepo, registry, support)
  private val succeeded = new PipelineRunSucceededWrites(pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, binaryRefRepo, alertEvaluationService, outputRepo, nodeSnapshotRepo, outputHistoryRepo, nodePayloadRepo, payloadConfig, support, terminal)
  private val executor  = new PipelineRunExecutor(pipelineStepRepo, dataSourceRepo, pipelineRunRepo, pipelineRunGuardRepo, guardConfig, guardClock, backend, support, terminal, succeeded)
  private val backfill  = new PipelineRunBackfill(pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, outputRepo, nodeSnapshotRepo, backend, support)
  private val queries   = new PipelineRunQueries(pipelineRepo, pipelineRunRepo, cache)
  import executor.runPipeline
  private val preview   = new PipelineRunPreview(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo, backend, support)

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
   *  skips [[submit]] entirely rather than reaching [[PipelineRunExecutor.runPipeline]]'s
   *  Spark-submission rejection. Mirrors `PipelineRunTerminalWrites.onBlockedRun`'s persistence
   *  pattern — best-effort `insertRun`, then `updateRunTerminal`/
   *  `pipelineRepo.updateLastRun`, both terminal status `"failed"` — so the
   *  reason is durable: it survives a page reload via the pipeline's
   *  `lastRunStatus` badge and its run history, not just the transient apply
   *  response. */
  def recordUnrunnable(
      pipelineId: PipelineId,
      reason: String,
      user: AuthenticatedUser,
      // HEL-1384 (design.md D4): the scheduled gate records its skip as `scheduled`; every other
      // caller keeps the repository's historical `manual` default.
      triggerSource: String = TriggerSource.Manual,
      // HEL-1384 (design.md D3a): a recurring caller (the scheduled gate) trims history the way
      // `submit`'s real-run path does, so a misconfigured cron cannot grow it without bound.
      pruneOldRuns: Boolean = false
  ): Future[RunResultResponse] = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    val now   = Instant.now()
    val insertWork: Future[Unit] =
      if (pipelineRunRepo != null)
        pipelineRunRepo.insertRun(runId, pipelineId, now, user, triggerSource = triggerSource).recoverWith { case ex =>
          log.warn(s"PipelineRunService.recordUnrunnable: insertRun failed for pipeline ${pipelineId.value}; continuing", ex)
          Future.successful(())
        }
      else Future.successful(())
    insertWork
      .flatMap { _ =>
        if (pruneOldRuns && pipelineRunRepo != null)
          pipelineRunRepo.deleteOldRuns(pipelineId, user, keepN = 10).recoverWith { case _ => Future.successful(()) }
        else Future.successful(())
      }
      .flatMap { _ =>
        if (pipelineRunRepo != null)
          // HEL-873 (design.md Decision 2a): a failed/never-attempted run records `[]`, never NULL.
          pipelineRunRepo.updateRunTerminal(runId, "failed", now, rowCount = None, errorLog = Some(reason), user, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson))
        else Future.successful(())
      }
      .flatMap { _ => pipelineRepo.updateLastRun(pipelineId, "failed", now, rowCount = None, user, truncated = Some(false)) }
      .map { _ =>
        // HEL-861 (design D4/task 3.5): no source read occurred here -- the run was never
        // attempted -- so leaving sourceTruncated/etc. on their defaulted `false`/`None` is
        // factually correct, not an oversight.
        RunResultResponse(
          rows = Vector.empty, rowCount = 0, runId = Some(runId.value), blocked = true, blockedReason = Some(reason)
        )
      }
  }

  /** Delegates to [[PipelineRunPreview.previewStep]], where the method and its documentation live. */
  def previewStep(pipelineId: PipelineId, stepId: String, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    preview.previewStep(pipelineId, stepId, user)

  /** Delegates to [[PipelineRunPreview.previewOutputs]], where the method and its documentation live. */
  def previewOutputs(pipelineId: PipelineId, outputId: Option[OutputId], user: AuthenticatedUser): Future[Either[ServiceError, PipelinePreviewResponse]] =
    preview.previewOutputs(pipelineId, outputId, user)

  /** Delegates to [[PipelineRunBackfill.backfillOutputNode]], where the method and its documentation live. */
  def backfillOutputNode(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      user: AuthenticatedUser,
      // HEL-913 task 5.10: names WHICH root when `nodeStepId` is `None` (a root-bound Output) --
      // without it, the backfill always evaluates the LOWEST-positioned root regardless of which
      // root the Output is actually bound to (`OutputRepository.rootIdOpt`'s job at write time;
      // this is the corresponding read/backfill-time thread-through). Required (no default): every
      // caller passes it explicitly -- the sole production caller (`OutputService`) passes the
      // Output's own `node.rootId`, which is `None` for a step-bound Output (`nodeStepId` already
      // names the node). `None` with `nodeStepId = None` names no root, so every root is evaluated.
      explicitRootId: Option[PipelineRootId]
  ): Future[Unit] =
    backfill.backfillOutputNode(pipelineId, nodeStepId, user, explicitRootId)

  /** Delegates to [[PipelineRunQueries.latestRun]], where the method and its documentation live. */
  def latestRun(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, LatestRunResponse]] =
    queries.latestRun(pipelineId, user)

  /** Delegates to [[PipelineRunQueries.runStatus]], where the method and its documentation live. */
  def runStatus(pipelineId: PipelineId, runId: String, user: AuthenticatedUser): Future[Either[ServiceError, CachedRunStatus]] =
    queries.runStatus(pipelineId, runId, user)

  /** Delegates to [[PipelineRunQueries.history]], where the method and its documentation live. */
  def history(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineRunRecord]]] =
    queries.history(pipelineId, user)

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

}

/** HEL-755 design.md D2: single source of truth for the source kinds the
 *  execution engine categorically can't run at all — `PipelineProposalService.
 *  createPipeline` consults this set to route to `recordUnrunnable` (a
 *  durable "blocked" run) instead of `submit`, without duplicating a kind
 *  list as a third copy.
 *
 *  HEL-758 (design.md D4): empty now that `rest_api`/`sql` both execute via
 *  `InProcessPipelineEngine.loadRows` (`PipelineRunExecutor.runPipeline`/`PipelineRunPreview.previewStep` no longer
 *  hardcode a rejection for either kind). Left in place, not deleted, as a
 *  forward-looking extension point for a future source kind the engine
 *  categorically can't run (e.g. a streaming source) — `recordUnrunnable` and
 *  `PipelineProposalService`'s guard branch stay wired to this set so a new
 *  unrunnable kind needs only a one-line addition here, no new plumbing. */
object PipelineRunService {
  val SparkUnsupportedKinds: Set[String] = Set.empty[String]

  /** HEL-873 (evaluation-1.md CR1): the recorded-and-complete `truncated_reads` payload -- a
    * literal matching `truncatedReadsToJson(None, Vector.empty)`'s object shape (never a bare
    * `"[]"`, which the read side no longer accepts as valid JSON for this column). Every
    * failure/blocked terminal write uses this same constant, including `SparkJobSubmitter`'s two
    * dormant call sites, so there is exactly one "recorded, nothing truncated, no primary count"
    * literal in the codebase to keep in sync with the write-side object shape. */
  val EmptyTruncationJson: String = """{"primaryAvailableRowCount":null,"reads":[]}"""

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

/** The `pipeline_runs.trigger_source` literals (HEL-417). Modeled as a
 *  plain-`String` constants holder rather than a sealed domain type — mirrors
 *  the existing bare-`String` convention `PipelineRunRow`/`PipelineRunRecord`
 *  already use for `status` (see design.md Decision 1). `External` is
 *  reserved for HEL-369; no caller passes it yet.
 *
 *  HEL-1093: `AutoRun` is set by `PipelineSchedulerService.tick`'s claim-and-fire pass when
 *  firing a debounced dataset-write auto-run (design.md Decision 3) — V110 widens the
 *  `pipeline_runs_trigger_source_check` CHECK constraint to admit it. */
object TriggerSource {
  val Manual: String    = "manual"
  val Scheduled: String = "scheduled"
  val External: String  = "external"
  val AutoRun: String   = "auto-run"
}
