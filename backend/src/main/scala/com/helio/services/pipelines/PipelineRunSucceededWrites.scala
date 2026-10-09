package com.helio.services.pipelines

import com.helio.services.alerts.AlertEvaluationService
import com.helio.api.protocols.pipelines.TruncatedReadResponse
import com.helio.api.routes.pipelines.RunStatusEvent
import com.helio.domain.model.{AssertionResult, AuthenticatedUser, BinaryRef, DataFieldType, DataSourceId, Output, PipelineId, PipelineRootId, PipelineRunId}
import com.helio.domain.engine.{NodeKey, NodeOutcome, PipelineRowJson, RootKey, SchemaField, SchemaInferenceEngine, StepKey}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.domain.history.{OutputSummaryReducer, PayloadHistoryConfig, PayloadOptIn}
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, NodeSnapshotRepository, OutputHistoryInsert, NodePayloadHistoryRepository, OutputHistoryRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory
import slick.dbio.DBIO
import spray.json._
import spray.json.DefaultJsonProtocol._
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** The unblocked-success materialization chain (node snapshots, history, binary refs, alert evaluation) and its
 *  terminal `succeeded` publish through [[PipelineRunTerminalWrites.publishTerminalAfter]]. Split out of
 *  `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunSucceededWrites(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRunRepo: PipelineRunRepository,
    binaryRefRepo: BinaryRefRepository,
    alertEvaluationService: AlertEvaluationService,
    outputRepo: OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository,
    outputHistoryRepo: OutputHistoryRepository,
    nodePayloadRepo: NodePayloadHistoryRepository,
    payloadConfig: PayloadHistoryConfig,
    support: PipelineRunSupport,
    terminal: PipelineRunTerminalWrites
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
  import support.truncatedReadsToJson
  import terminal.{persistAssertions, publishTerminalAfter}

  /** HEL-1271: the run's Output configs in ONE query (privileged read; `outputs` was already
   *  ACL-scoped by `listByPipelineInternal`), needed only by the history summary. Empty when no
   *  history repository is wired, so history-free fixtures pay nothing. */
  private def historyConfigs(outputs: Vector[Output]): Future[Map[String, JsObject]] =
    if (outputHistoryRepo == null) Future.successful(Map.empty)
    else outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))

  /** The pre-existing succeeded path (all-passing or warn-only), unchanged in
   *  behavior; the assert-fail-policy blocked path lives apart, in
   *  `PipelineRunTerminalWrites.onBlockedRun`. */
  private[pipelines] def onUnblockedRunSuccess(
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
      truncatedReads:     Vector[TruncatedReadResponse]
  ): Future[Option[String]] = {
    def writesChain(): Future[Option[String]] = {
      val now = Instant.now()
      // HEL-905 (design.md Decisions 3, 4): a materialized node is one carrying >= 1 `outputs`
      // row. For each materialized node, `node_snapshots` is replaced atomically (per-node, via
      // `overwriteRows`'s existing delete-then-insert-in-one-transaction), sequenced only after the
      // whole tree walk has already completed successfully -- cross-node atomicity is explicitly
      // NOT provided (see design.md Decision 3): a mid-sequence failure leaves earlier nodes
      // updated and later ones untouched.
      val materializedWrites: Future[Unit] =
        if (nodeSnapshotRepo != null)
          outputRepo.listByPipelineInternal(pipelineId).flatMap(outputs => historyConfigs(outputs).map(outputs -> _)).flatMap { case (outputs, configsById) =>
            // HEL-913 (design.md R12, task 5.8 runtime half): keyed by NodeKey, not the old
            // `Option[String]`/`None`-means-root encoding -- a root-bound Output (`stepId = None`)
            // keys on `RootKey(output.node.rootId)`, so it only ever matches THAT root's outcome,
            // never silently matching "any root" the way a bare `None` used to under multi-root.
            // An Output somehow missing BOTH `stepId` and `rootId` (pre-V98 legacy shape) is
            // skipped rather than guessed at.
            val outputsByNodeKey: Map[NodeKey, Vector[Output]] =
              outputs.flatMap { o =>
                val keyOpt: Option[NodeKey] = o.node.stepId match {
                  case Some(sid) => Some(StepKey(sid.value))
                  case None      => o.node.rootId.map(rid => RootKey(rid.value))
                }
                keyOpt.map(k => k -> o)
              }.groupBy(_._1).view.mapValues(_.map(_._2).toVector).toMap
            val materializedNodeKeys = outputsByNodeKey.keySet.intersect(nodeOutcomes.keySet)
            // Sequenced (not parallel) so a later node's failure never races an earlier node's
            // write -- matches design.md's "sequenced only after... completed successfully".
            materializedNodeKeys.foldLeft(Future.successful(())) { (accF, nodeKey) =>
              accF.flatMap { _ =>
                val outcome = nodeOutcomes(nodeKey)
                val nodeJsRows = outcome.rows.map { rowMap =>
                  JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
                }.toVector
                val (nodeStepIdOpt, explicitRootIdOpt) = nodeKey match {
                  case StepKey(sid) => (Some(sid), None)
                  case RootKey(rid) => (None, Some(rid))
                }
                val nodeOutputs = outputsByNodeKey.getOrElse(nodeKey, Vector.empty)
                val replace: Future[Unit] =
                  if (outputHistoryRepo == null) nodeSnapshotRepo.overwriteRows(pipelineId.value, nodeStepIdOpt, nodeJsRows, explicitRootIdOpt)
                  else {
                    // HEL-1271 (D9): the summary insert shares this node's replace transaction -- NOT
                    // best-effort; a failure here fails the node exactly like a snapshot-insert failure.
                    val entries = nodeOutputs.map { o =>
                      OutputHistoryInsert(
                        outputId      = o.id.value,
                        pipelineId    = pipelineId.value,
                        nodeStepId    = nodeStepIdOpt,
                        rootId        = explicitRootIdOpt,
                        runId         = Some(runId.value),
                        triggerSource = triggerSource,
                        capturedAt    = now,
                        rowCount      = nodeJsRows.size,
                        summary       = OutputSummaryReducer.summarize(nodeJsRows, o.kind, configsById.getOrElse(o.id.value, JsObject.empty))
                      )
                    }
                    // HEL-1276 (D9): when an Output on this node opted in, the payload insert joins the same
                    // transaction and only the opted-in Outputs' points link to it. With no opt-in nothing
                    // is built or measured.
                    val optedIn = nodeOutputs.filter(o => PayloadOptIn.enabled(configsById.getOrElse(o.id.value, JsObject.empty))).map(_.id.value).toSet
                    val historyAction: DBIO[Unit] =
                      if (nodePayloadRepo == null || optedIn.isEmpty) outputHistoryRepo.insertAction(entries)
                      else
                        nodePayloadRepo
                          .writeAction(pipelineId.value, nodeStepIdOpt, explicitRootIdOpt, Some(runId.value), triggerSource, now, nodeJsRows, payloadConfig)
                          .flatMap(pid => outputHistoryRepo.insertAction(entries.map(e => if (optedIn(e.outputId)) e.copy(payloadId = pid) else e)))
                    nodeSnapshotRepo.overwriteRowsWith(pipelineId.value, nodeStepIdOpt, nodeJsRows, explicitRootIdOpt, historyAction)
                  }
                replace.flatMap { _ =>
                  // HEL-905 (design.md Decision 4): per-Output shallow-union schema derivation
                  // over this node's own row set. Two Outputs on the same node get independently
                  // derived (but identical) schemas -- no sharing/caching needed at this scale.
                  val inferredFields = SchemaInferenceEngine.inferShallowFromJsObjects(nodeJsRows)
                  val schema = inferredFields.map(f => SchemaField(f.name, DataFieldType.asString(f.dataType))).toVector
                  Future
                    .sequence(nodeOutputs.map(o => outputRepo.updateSchemaInternal(o.id, schema)))
                    .map(_ => ())
                }
              }
            }
          }
        else Future.successful(())
      // HEL-216: wire BinaryRefRepository.overwriteForNode into the one real
      // row-write call site, generically over row shape (not gated on source
      // kind) — see design.md Decision "BinaryRefRepository...wired into
      // PipelineRunExecutor.onRunSuccess". Extracted from resultRows (the
      // post-step, final row values — not the pre-step source rows) so the
      // refs match exactly what jsRows/rowsUpsert just wrote. HEL-904 (task
      // 3.4): re-keyed to `(pipelineId, trunkLastStepId)` instead of the
      // retired `dataTypeId`.
      //
      // HEL-905: still scoped to the trunk's last node only (not every
      // materialized node) -- extending binary-ref extraction to tail nodes is
      // deferred; no AC of this ticket requires it (see files-modified.md).
      // HEL-913 (design.md R10): scoped to the LOWEST-positioned root's trunk specifically --
      // the same root `TreeWalkResult.rows` (== `resultRows` here) is derived from, per R10's
      // explicit "rows, trunkOf(...).lastOption, and the binary-ref key must all be derived from
      // the same root and the same node" agreement. `trunkOfRoot` (not the ambiguous whole-
      // pipeline `trunkOf`) is what makes this hold under multi-root.
      val trunkLastStepIdFut: Future[Option[String]] =
        if (binaryRefRepo != null)
          for {
            steps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
            rootIdOfStep <- pipelineStepRepo.rootIdsOf(pipelineId)
          } yield pipelineStepRepo.trunkOfRoot(steps, rootIdOfStep, PipelineRootId(lowestRootId)).lastOption.map(_.id.value)
        else Future.successful(None)
      val binaryRefsUpsert =
        if (binaryRefRepo != null)
          trunkLastStepIdFut.flatMap { trunkLastStepId =>
            val explicitRootId = if (trunkLastStepId.isEmpty) Some(lowestRootId) else None
            binaryRefRepo.overwriteForNode(pipelineId.value, trunkLastStepId, extractBinaryRefs(pipelineId, trunkLastStepId, resultRows), explicitRootId)
          }
        else Future.successful(())
      // HEL-466: fire alert-rule evaluation against the rows just written.
      // Wrapped in recoverWith (matching the existing discipline at `PipelineRunExecutor
      // .executeRun`'s preExec/insertRun handling) so an evaluation
      // failure is logged inside AlertEvaluationService and never fails or
      // rolls back this run — see design.md "Per-rule isolation"/"Hook
      // placement".
      // HEL-905 (design.md Decision 2/tasks 4; evaluation-1.md CR3): evaluate per Output of every
      // materialized node, using THAT node's own row set (`nodeOutcomes`) rather than the trunk's
      // final rows -- a tail Output must be evaluated against its own frame, not the trunk's
      // terminal one. A node with NO outcome is skipped explicitly (never silently falls back to a
      // DIFFERENT node's rows -- evaluating an Output's rules against the wrong node's data is
      // worse than not evaluating them at all) and logged, since every node the walk actually
      // materializes always has an outcome; a miss here means a real bug elsewhere.
      val alertEvaluation =
        if (alertEvaluationService != null)
          outputRepo.listByPipelineInternal(pipelineId).flatMap { outputs =>
            Future
              .sequence(outputs.map { output =>
                // HEL-913 (design.md R12): a root-bound Output (`stepId = None`) keys on its OWN
                // `RootKey(rootId)` -- never a bare `None` that would ambiguously match any root.
                val nodeKeyOpt: Option[NodeKey] = output.node.stepId match {
                  case Some(sid) => Some(StepKey(sid.value))
                  case None      => output.node.rootId.map(rid => RootKey(rid.value))
                }
                nodeKeyOpt.flatMap(nodeOutcomes.get) match {
                  case None =>
                    log.error(
                      s"AlertEvaluationService.evaluateForOutput skipped for output ${output.id.value}, " +
                        s"run ${runId.value}: no NodeOutcome for node key $nodeKeyOpt (never evaluated by the tree walk)"
                    )
                    Future.successful(())
                  case Some(nodeOutcome) =>
                    alertEvaluationService
                      .evaluateForOutput(output.id, nodeOutcome.rows, Some(runId.value))
                      .recoverWith { case ex =>
                        log.error(s"AlertEvaluationService.evaluateForOutput failed for output ${output.id.value}, run ${runId.value}", ex)
                        Future.successful(())
                      }
                }
              })
              .map(_ => ())
          }
        else Future.successful(())
      // HEL-873 (design.md Decision 2/tasks 2.2/2.3): a successful run always writes a non-null
      // value -- `[]` when nothing was truncated -- written in the SAME statement as `rowCount`/
      // `status` on both tables.
      val truncatedReadsJson = truncatedReadsToJson(primaryAvailableRowCount, truncatedReads)
      val updateMeta = pipelineRepo.updateLastRun(pipelineId, "succeeded", now, rowCount = Some(resultRows.size.toLong), user, truncated = Some(truncatedReads.nonEmpty)).map(_ => ())
      val updateRun =
        if (pipelineRunRepo != null)
          pipelineRunRepo.updateRunTerminal(runId, "succeeded", now, rowCount = Some(resultRows.size), errorLog = None, user, truncatedReadsJson = Some(truncatedReadsJson)).map(_ => ())
        else Future.successful(())
      // HEL-509 (419-B): insertRun already ran during preExec, so the parent
      // `pipeline_runs` row exists before this real-run success path runs —
      // no ordering constraint here (unlike `PipelineRunTerminalWrites.onDryRunSuccess`).
      val assertionsInsert = persistAssertions(runId, assertionResults)
      // HEL-462 (design D4): best-effort schema-drift baseline capture — the
      // current source schema (same derivation `PipelineService.analyze` uses)
      // becomes the new `last_source_schema` baseline. Only real, non-dry
      // successes reach this method (`onDryRunSuccess` never calls it), which
      // is exactly "a successful run" in the ticket's sense. `recoverWith`
      // ensures a resolution/write failure here never fails or blocks the run.
      // HEL-904 (task 4.1): derives the baseline from the source's own
      // `inferredSchema` (mirroring `PipelineService.analyze`'s own
      // rewiring, see task 4.3) instead of the retired
      // `dataTypeRepo.findBySourceId` -> `deriveSourceSchema` path.
      val baselineUpsert: Future[Unit] =
        dataSourceRepo.findByIdOwned(sourceDataSourceId, user)
          .map(_.map(_.inferredSchema).getOrElse(Vector.empty))
          .flatMap { schema =>
            pipelineRepo.updateLastSourceSchema(pipelineId, schema.toJson.compactPrint, user)
          }
          .recoverWith { case ex =>
            log.warn(s"HEL-462: schema-drift baseline capture failed for pipeline ${pipelineId.value}", ex)
            Future.successful(())
          }
        for {
          _ <- materializedWrites
          _ <- binaryRefsUpsert
          _ <- alertEvaluation
          _ <- updateMeta
          _ <- updateRun
          _ <- assertionsInsert
          _ <- baselineUpsert
        } yield None
    }
    // HEL-1366: `succeeded` is published only after the whole chain (snapshots, run status,
    // last-run metadata, ...) has completed, so a subscriber reading on the event sees this run's
    // results. Edge: `for` fails fast, so if `materializedWrites` fails the event can fire while the
    // eagerly-started `updateRun` is still in flight (write-failure path only).
    publishTerminalAfter(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size), runId = Some(runId.value)), writesChain())
  }

  /** Extract every `binary-ref`-shaped field value from `rows` into
   *  [[BinaryRef]] records for `binaryRefRepo.overwriteForNode` (renamed from
   *  `overwriteForDataType` by HEL-904 task 3.4's re-key to `(pipelineId, nodeStepId)`)
   *  (HEL-217's intended write contract, first wired by HEL-216). Structural,
   *  not schema-driven: a value matches when it's a `Map` carrying all four
   *  required keys with the expected value types — specific enough that a
   *  false-positive match on an unrelated JSON object is very unlikely (see
   *  design.md's Risks/Trade-offs section); a false negative only means a
   *  missing secondary-index entry, non-fatal since `binary_refs` is
   *  explicitly a derived index, never the row read path. */
  private def extractBinaryRefs(pipelineId: PipelineId, nodeStepId: Option[String], rows: Seq[Map[String, Any]]): Vector[BinaryRef] = {
    val now = Instant.now()
    rows.zipWithIndex.flatMap { case (row, rowIndex) =>
      row.collect {
        case (fieldName, value: Map[String, Any] @unchecked) if isBinaryRefShape(value) =>
          BinaryRef(
            id         = UUID.randomUUID().toString,
            pipelineId = pipelineId.value,
            nodeStepId = nodeStepId,
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
}
