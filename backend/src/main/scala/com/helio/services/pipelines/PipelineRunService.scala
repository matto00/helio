package com.helio.services.pipelines

import com.helio.domain.ai.AiStepClient
import com.helio.services.ServiceError
import com.helio.services.alerts.AlertEvaluationService
import com.helio.services.audit.AuditService
import com.helio.api.protocols.pipelines.{LatestRunResponse, OutputPreviewEntry, PipelinePreviewResponse, PipelineRunRecord, RunResultResponse}
import com.helio.api.routes.pipelines.PipelineRunRegistry
import com.helio.domain.model.{AssertionSink, AuthenticatedUser, DataSource, Output, OutputId, Pipeline, PipelineId, PipelineRootId, PipelineRunId, PipelineStepId, TruncatedRead, TruncationSink}
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeDependencyClosure, PipelineCostEstimator, PipelineExecutionBackend, PipelineRowJson, StepKey}
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
    // history branch below, so a fixture without a payload repo writes summaries exactly as before.
    nodePayloadRepo: NodePayloadHistoryRepository = null,
    payloadConfig: PayloadHistoryConfig = PayloadHistoryConfig.Defaults,
    // HEL-1106 (design.md D2): nullable-default convention mirrors binaryRefRepo/
    // alertEvaluationService above -- threaded through to InProcessPipelineEngine so an
    // `analyzewithai` step can call the model. Defaults to AiStepClient.Unavailable so every
    // fixture that omits it degrades to the named `ai-unavailable` run failure rather than an NPE.
    aiStepClient: AiStepClient = AiStepClient.Unavailable,
    // HEL-505 (design.md Decisions 1/2): nullable-default convention mirrors alertEvaluationService
    // above -- fixtures that don't pass a PipelineRunGuardRepository simply skip the
    // rate-limit check in `executeRun` (guard off, matching every other nullable-optional
    // collaborator's fixture behavior in this file).
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

  // HEL-330 (design.md Decision 3): the two execution call sites (`executeRun`, `previewStep`)
  // depend on this trait reference, not `engine` directly.
  private val backend: PipelineExecutionBackend =
    if (executionBackend != null) executionBackend else new InProcessExecutionBackend(engine, pipelineStepRepo)

  // HEL-1371: concern-focused collaborators, built after `backend` (eagerly initialised) and in dependency order.
  private val support   = new PipelineRunSupport(pipelineRepo, dataSourceRepo)
  private val terminal  = new PipelineRunTerminalWrites(pipelineRepo, pipelineRunRepo, registry, support)
  private val succeeded = new PipelineRunSucceededWrites(pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, binaryRefRepo, alertEvaluationService, outputRepo, nodeSnapshotRepo, outputHistoryRepo, nodePayloadRepo, payloadConfig, support, terminal)
  private val executor  = new PipelineRunExecutor(pipelineStepRepo, dataSourceRepo, pipelineRunRepo, pipelineRunGuardRepo, guardConfig, guardClock, backend, support, terminal, succeeded)
  private val backfill  = new PipelineRunBackfill(pipelineRepo, pipelineStepRepo, dataSourceRepo, pipelineRunRepo, outputRepo, nodeSnapshotRepo, backend, support)
  private val queries   = new PipelineRunQueries(pipelineRepo, pipelineRunRepo, cache)
  import support.{executionFailureError, logExecutionFailure, resolveAllRootDataSourcesInternal, truncationFields}
  import executor.runPipeline

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

  /** Run only the prefix of `steps` ending at `stepId`, returning at most 10
   *  rows for the inline preview tray.
   *  HEL-279: sharing-aware — owner and grantees can preview. */
  def previewStep(pipelineId: PipelineId, stepId: String, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    // `rootId = None`: a step-targeted preview walks that step's OWN ancestor chain back to
    // whichever root it actually belongs to (via the full `roots` vector `previewAtNode` passes
    // to `backend.execute` in the `targetStepId.isDefined` arm) -- unlike the source-level arm,
    // a step preview is never ambiguous about which root, so no explicit `rootId` is needed here.
    previewAtNode(pipelineId, Some(stepId), rootId = None, user)

  /** `POST /api/pipelines/:id/preview?outputId=` (HEL-906 cycle 10, P1.4's `preview_outputs`
   *  dependency, `preview_outputs(pipelineId, outputId?)` -- `outputId` genuinely OPTIONAL, per
   *  the coordinator's ruling that narrowing the AC to "outputId required" was not an option):
   *
   *   - `outputId` present: dry-run preview for exactly that Output, scoped to its own node
   *     (`output.node.stepId`, `None` meaning the pipeline's raw source). Resolved via
   *     `outputRepo.findById` (the SAME sharing-aware RLS select `GET /api/outputs/:id` uses)
   *     before ever touching `pipelineId` -- a caller cannot probe a different pipeline's node
   *     by supplying a mismatched `pipelineId`/`outputId` pair (`output.node.pipelineId` is
   *     checked against the path's `pipelineId`).
   *   - `outputId` absent: dry-run preview for EVERY Output on the pipeline, gated by the
   *     pipeline-level ACL (`pipelineRepo.findByIdShared`) since there is no single Output to
   *     resolve ACL through. Outputs sharing the same node (`node.stepId`) are computed ONCE,
   *     not once per Output, then fanned back out -- `previewAtNode` re-runs the tree-walk
   *     engine from scratch, so this avoids doing the same work N times for N Outputs on one
   *     node. If ANY node's preview fails, the whole call fails (the first failure encountered)
   *     rather than returning a partial, silently-incomplete envelope.
   *
   *  BOTH arms return the SAME `PipelinePreviewResponse{outputs: [{outputId, preview}]}`
   *  envelope -- the single-Output arm is simply that envelope narrowed to one entry -- so a
   *  caller (P1.4's MCP tool) has exactly one response shape to parse regardless of whether
   *  `outputId` was supplied.
   *
   *  Delegates to the SAME `previewAtNode` helper `previewStep` uses in both arms -- guarantees
   *  IDENTICAL no-run-state-mutation semantics: neither this nor `previewStep` ever calls
   *  `pipelineRepo.updateLastRun`/`pipelineRunRepo.insertRun` (both only reachable from
   *  `executeRun`, this method's sibling, never from here) -- verified by
   *  `PipelineRunServiceSpec`'s "does not mutate last_run_status/last_run_at" tests (BOTH the
   *  single-Output and all-Outputs variants) and `OutputRoutesSpec`'s HTTP-level equivalents. */
  def previewOutputs(pipelineId: PipelineId, outputId: Option[OutputId], user: AuthenticatedUser): Future[Either[ServiceError, PipelinePreviewResponse]] =
    outputId match {
      case Some(id) =>
        outputRepo.findById(id, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Output not found: " + id.value)))
          case Some(output) if output.node.pipelineId != pipelineId =>
            Future.successful(Left(ServiceError.NotFound("Output not found: " + id.value)))
          case Some(output) =>
            // HEL-913 (evaluation-1.md cycle 2, Priority 2 Site B): `output.node.rootId`
            // threaded through -- dropping it here is exactly the defect this fixes: EVERY
            // root-bound Output on EVERY root used to collapse to key `None` and silently
            // read `roots.head`'s rows regardless of which root the Output actually names.
            previewAtNode(pipelineId, output.node.stepId.map(_.value), output.node.rootId.map(_.value), user).map(_.map { result =>
              PipelinePreviewResponse(Vector(OutputPreviewEntry(id.value, result)))
            })
        }
      case None =>
        pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
          case Some(_) =>
            outputRepo.listByPipelineInternal(pipelineId).flatMap { outputs =>
              // HEL-913 (evaluation-1.md cycle 2, Priority 2 Site B): keyed by the FULL
              // `(stepId, rootId)` pair, not `stepId` alone -- a bare `stepId` key collapsed
              // every root-bound Output (stepId = None) onto ONE shared key regardless of
              // which root it actually names, so a two-root pipeline's root-1 Output silently
              // read root-0's rows via `byNodeKey`. Two Outputs sharing (None, Some(rootId))
              // legitimately share one preview call -- they read the SAME root's raw rows --
              // but two Outputs differing only in `rootId` never collapse into each other now.
              val distinctNodeKeys = outputs.map(o => (o.node.stepId.map(_.value), o.node.rootId.map(_.value))).distinct
              Future.traverse(distinctNodeKeys) { case (stepKey, rootKey) =>
                previewAtNode(pipelineId, stepKey, rootKey, user).map((stepKey, rootKey) -> _)
              }.map { resultsByNode =>
                resultsByNode.collectFirst { case (_, Left(err)) => err } match {
                  case Some(err) => Left(err)
                  case None =>
                    val byNodeKey = resultsByNode.collect { case (k, Right(r)) => k -> r }.toMap
                    val entries = outputs.map(o => OutputPreviewEntry(o.id.value, byNodeKey((o.node.stepId.map(_.value), o.node.rootId.map(_.value)))))
                    Right(PipelinePreviewResponse(entries))
                }
              }
            }
        }
    }

  /** Shared implementation for `previewStep`/`previewOutputs` -- `targetStepId = None` means
   *  "preview the pipeline's raw source rows" (an empty step slice); `Some(id)` walks the
   *  path-to-root ending at that step, exactly as `previewStep` always has. Never mutates run
   *  state (`pipelineRepo.updateLastRun`/`pipelineRunRepo.insertRun` are unreachable from here)
   *  — verified by `PipelineRunServiceSpec`'s "does not mutate last_run_status/last_run_at"
   *  tests (`PipelineRunService.previewOutputs` describe block, ONE test per arm -- single-Output
   *  and all-Outputs), and at the HTTP layer by `OutputRoutesSpec`'s equivalent tests (also one
   *  per arm).
   *
   *  HEL-913 (evaluation-1.md cycle 2, Priority 2 Site B): `rootId` names WHICH root's raw rows
   *  to preview when `targetStepId` is `None` -- previously this method took no such parameter
   *  and the `targetStepId.isEmpty` arm always used `roots.head` (the lowest-positioned root),
   *  so EVERY root-bound Output on EVERY root silently previewed root 0's rows. `None` here
   *  (no explicit root) falls back to `roots.head`, which is correct ONLY for a genuinely
   *  single-root pipeline -- every caller passing `targetStepId = None` for a real Output now
   *  also passes that Output's own `rootId` (see `previewOutputs`), so this fallback is reached
   *  only by `previewStep`'s `Some(stepId)` call (which ignores `rootId` entirely, see below) or
   *  a single-root pipeline's Output. Unused when `targetStepId` is defined -- a step's ancestor
   *  root is resolved by walking `parentStepId` against the FULL `roots` vector already passed
   *  to `backend.execute` in that arm, never from this parameter.
   *
   *  HEL-913 (evaluation-2.md item 2): a NAMED `rootId` that does not resolve among the
   *  pipeline's actual roots FAILS CLOSED (a named `UnprocessableEntity`), matching
   *  `evaluateNodeRowsForBackfill`'s sibling handling of the identical mismatch -- it does NOT
   *  fall back to `roots.head`. `roots.head` is reached only for the "no `rootId` given" case
   *  described above, never as a silent substitute for an unresolvable named one. */
  private def previewAtNode(pipelineId: PipelineId, targetStepId: Option[String], rootId: Option[String], user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) =>
        // Privileged: pipeline ACL is the authoritative gate. findByIdInternal is correct here.
        resolveAllRootDataSourcesInternal(pipelineId).flatMap {
          case roots if roots.isEmpty =>
            Future.successful(Left(ServiceError.UnprocessableEntity(
              "DataSource not found for pipeline: " + pipelineId.value
            )))
          case roots if targetStepId.isEmpty =>
            // Source-level preview (an Output bound directly to the pipeline's raw source, no
            // step): run the engine with an empty step slice, so `outcome.rows`/`outcome.nodeOutcomes`
            // are simply the source's own rows, unfiltered by any step.
            //
            // HEL-913 (evaluation-1.md cycle 2, Priority 2 Site B): `selectedRoot` picks the
            // NAMED root (`rootId`), falling back to `roots.head` only when no `rootId` was
            // given (see the method doc above) -- NOT `roots.head` unconditionally as before.
            // `backend.execute` is called with ONLY that one root (`Vector(selectedRoot)`), not
            // the full `roots` vector: with zero steps, `outcome.rows` is simply whichever
            // root(s) it was given, so passing every root here would silently mix roots into
            // one preview rather than isolating the named one. This is a preview-only read
            // (never `updateLastRun`/`insertRun`), so it does not touch R9's atomic-real-run
            // "every root, every Output" guarantee, which only governs `executeRun`.
            //
            // HEL-913 (evaluation-2.md item 2): a NAMED `rootId` that does not resolve among
            // `roots` FAILS CLOSED (a named error) rather than silently falling back to
            // `roots.head` -- matches `evaluateNodeRowsForBackfill`'s sibling handling of the
            // identical mismatch (`roots.isEmpty => Future.successful(())`, never a fallback to
            // a different root). No FK path is known to produce this mismatch today (`outputs
            // .root_id` cascades from `pipeline_roots`, which cascades from `data_sources`), but
            // "no caller can currently trigger it" is a fact about the current cascade, not a
            // guarantee this method should rely on -- the banned `getOrElse` shape is the same
            // one 5.9 removed from analyze, for the same reason.
            rootId match {
              case Some(rid) if !roots.exists(_._1 == rid) =>
                Future.successful(Left(ServiceError.UnprocessableEntity(
                  s"DataSource not found for pipeline: ${pipelineId.value} (root '$rid' not found among its roots)"
                )))
              case _ =>
            val selectedRoot = rootId.flatMap(rid => roots.find(_._1 == rid)).getOrElse(roots.head)
            val dataSource = selectedRoot._2
            val truncationSink = new TruncationSink
            backend
              .execute(pipeline, Vector(selectedRoot), Vector.empty, dataSourceRepo, new AssertionSink, truncationSink,
                ownerUserId = Some(pipeline.ownerId.value))
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
                logExecutionFailure(s"previewAtNode (source-level) failed for pipeline ${pipelineId.value}", ex)
                Left(executionFailureError(ex))
              }
            }
          case roots =>
            val dataSource = roots.head._2
            val stepId = targetStepId.get
            // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list.
            // HEL-758: every source kind (including rest_api/sql) now reaches
            // this preview path uniformly (design.md D3).
            pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
              // HEL-904 follow-on ruling: listByPipelineInternal already returns
              // executionOrder (the trunk/tail structural order) -- a global
              // `.sortBy(_.position)` here would re-break run order, since every
              // trunk step's `position` is now constantly `0`.
              val sortedSteps = allSteps
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
                  // HEL-970 (design.md D1/D2): the previewed slice is the target step's
                  // transitive DEPENDENCY CLOSURE -- every ancestor reachable by `parentStepId`
                  // AND, for a `join`/`union`/`lookup` step, every lane dependency's own closure,
                  // to a fixed point -- not a positional slice over `executionOrder` (which
                  // emits a node's tails BEFORE continuing the trunk, so a positional slice can
                  // fold an unrelated tail's steps into the "prefix") and not merely the
                  // ancestor chain alone (which omits a rejoin's non-ancestor secondary lane
                  // entirely, HEL-970's defect). The engine's own edge set (parent + lane,
                  // `InProcessPipelineEngine.executeTree`) is authoritative; this delegates to
                  // the shared helper rather than re-deriving it here.
                  // Disabled ancestors are NOT pre-filtered here (see 3.1a) -- the engine's own
                  // in-place skip (Decision 7) handles them; the separate guard above already
                  // rejects previewing a disabled step itself.
                  val target      = sortedSteps(k)
                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)
                  // HEL-1108 (design.md D10/C10): a preview whose closure contains an ENABLED AI
                  // step issues a real model call charged to the pipeline OWNER (D5) -- without
                  // this check, a read-only viewer grantee could repeatedly preview such a node
                  // and drain the owner's combined chat+pipeline daily budget. `closureOf` does
                  // not pre-filter disabled ancestors (see the comment above), so this check
                  // must too, else a disabled AI step would over-deny a viewer previewing an
                  // otherwise AI-free closure.
                  val closureHasEnabledAiStep = slicedSteps.exists(s => s.enabled && PipelineCostEstimator.AiOps.contains(s.kind))
                  val authorizedForAi: Future[Boolean] =
                    if (!closureHasEnabledAiStep) Future.successful(true)
                    else if (pipeline.ownerId.value == user.id.value) Future.successful(true)
                    else pipelineRepo.findGrantRole(pipelineId, user).map(_.contains("editor"))
                  authorizedForAi.flatMap {
                    case false =>
                      Future.successful(Left(ServiceError.Forbidden("Forbidden")))
                    case true =>
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
                    .execute(pipeline, roots, slicedSteps.toVector, dataSourceRepo, new AssertionSink, truncationSink,
                      ownerUserId = Some(pipeline.ownerId.value))
                    .map { outcome =>
                      // HEL-905 (evaluation-1.md CR1): `outcome.rows` is always the TRUNK's
                      // terminal frame -- for a target step on a tail, the tail's own rows live
                      // only in `nodeOutcomes`, keyed by the target's own id. Falling back to
                      // `outcome.rows` covers the (only) case where they're the same value: the
                      // target step IS the trunk's own terminal step.
                      val targetRows = outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)
                      val allJsRows = targetRows.map { rowMap =>
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
                    logExecutionFailure(s"previewStep failed for pipeline ${pipelineId.value}, step $stepId", ex)
                    Left(executionFailureError(ex))
                  }
                  }
              }
            }
        }
    }

  /** Delegates to [[PipelineRunBackfill.backfillOutputNode]], where the method and its documentation live. */
  def backfillOutputNode(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      user: AuthenticatedUser,
      // HEL-913 task 5.10: names WHICH root when `nodeStepId` is `None` (a root-bound Output) --
      // without it, the backfill always evaluates the LOWEST-positioned root regardless of which
      // root the Output is actually bound to (`OutputRepository.rootIdOpt`'s job at write time;
      // this is the corresponding read/backfill-time thread-through). Defaulted to `None` so
      // every pre-existing call site (and the single-root case, where there is only one root to
      // mean anyway) is unaffected.
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
 *  `InProcessPipelineEngine.loadRows` (`runPipeline`/`previewStep` no longer
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
