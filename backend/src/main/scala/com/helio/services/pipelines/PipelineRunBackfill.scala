package com.helio.services.pipelines

import com.helio.domain.model.{AssertionSink, AuthenticatedUser, DataFieldType, PipelineId, PipelineRootId, PipelineStepId, TruncationSink}
import com.helio.domain.engine.{NodeDependencyClosure, PipelineExecutionBackend, PipelineRowJson, SchemaField, SchemaInferenceEngine, StepKey}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory
import spray.json._
import scala.concurrent.{ExecutionContext, Future}

/** Targeted single-node Output backfill (HEL-947). Split out of `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunBackfill(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRunRepo: PipelineRunRepository,
    outputRepo: OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository,
    backend: PipelineExecutionBackend,
    support: PipelineRunSupport
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
  import support.{logExecutionFailure, resolveAllRootDataSourcesInternal}

  /** HEL-947 (revised after measured write-amplification cost — see PR #525 discussion):
   *  targeted, single-node backfill triggered from `OutputService.create`/`update`, NOT an
   *  unconditional per-run write for every node in the tree. The unconditional approach
   *  (materializing `node_snapshots` for every node on every run, regardless of whether it has
   *  an Output) was measured against a 14-step/10k-row pipeline: 15x the `node_snapshots` row
   *  count (1,000 -> 15,000 under this environment's 1,000-row read cap; ~10x-15x uncapped, per
   *  the `count(*)` delta across every node vs. only the Output-bound one), ~14x the table's
   *  `pg_total_relation_size` (393,216 -> 5,603,328 bytes), and roughly 2x the run's own
   *  wall-clock time (0.3-0.4s -> ~0.62s steady-state) — a cost paid on EVERY future run of
   *  EVERY pipeline, scaling with node count regardless of whether any node ever gets an
   *  Output. That is unbounded, ongoing cost for a benefit (backfill) that is only ever needed
   *  once per newly-Output-bound node.
   *
   *  This method pays that cost instead ONLY at the moment an Output is created or edited
   *  against a node with no existing snapshot — a single node, evaluated once, via the SAME
   *  `backend.execute` tree-walk `previewAtNode` already uses for `previewStep`/`previewOutputs`
   *  (no new re-execution machinery; this reuses the existing single-node dry-evaluation path,
   *  just without `previewAtNode`'s 10-row UI cap). `onUnblockedRunSuccess`'s own per-run write
   *  is UNCHANGED from its pre-HEL-947 behavior (nodes with >= 1 `outputs` row only) — ordinary
   *  runs pay no extra cost.
   *
   *  Never blocks or fails the caller: `OutputService.create`/`update` fire this off the request
   *  path (not awaited by the HTTP response) and every failure mode here degrades to a no-op,
   *  leaving the HEL-946 "not run yet" (`materialized: false`) state exactly as it was.
   *
   *  Skips entirely (no-op) when:
   *    - `nodeSnapshotRepo` is null (nullable-optional wiring, mirrors every other such fixture
   *      in `PipelineRunService`'s constructor).
   *    - the node already has >= 1 snapshot row (nothing to backfill — either a prior run
   *      already materialized it, or a prior call to this same method already did).
   *    - the pipeline has never had a successful run (`pipelineRunRepo.latestSuccessfulCompletedAtInternal`
   *      returns `None`) — there is nothing to backfill FROM, and the HEL-946 warning path must
   *      keep showing, not a misleadingly-empty "materialized" snapshot.
   */
  def backfillOutputNode(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      user: AuthenticatedUser,
      // HEL-913 task 5.10: names WHICH root when `nodeStepId` is `None` (a root-bound Output) --
      // without it, the backfill always evaluates the LOWEST-positioned root regardless of which
      // root the Output is actually bound to (`OutputRepository.rootIdOpt`'s job at write time;
      // this is the corresponding read/backfill-time thread-through). Required (no default): every
      // caller passes it explicitly -- `None` for a step-bound Output, or for the single-root case
      // where there is only one root to mean anyway.
      explicitRootId: Option[PipelineRootId]
  ): Future[Unit] =
    if (nodeSnapshotRepo == null) Future.successful(())
    else
      nodeSnapshotRepo.listRows(pipelineId.value, nodeStepId.map(_.value), limit = Some(1), explicitRootId = explicitRootId.map(_.value)).flatMap { existing =>
        if (existing.nonEmpty) Future.successful(())
        else {
          val hasSucceededOnce: Future[Boolean] =
            if (pipelineRunRepo == null) Future.successful(false)
            else pipelineRunRepo.latestSuccessfulCompletedAtInternal(pipelineId).map(_.isDefined)
          hasSucceededOnce.flatMap {
            case false => Future.successful(())
            case true  => evaluateNodeRowsForBackfill(pipelineId, nodeStepId, user, explicitRootId)
          }
        }
      }.recoverWith { case ex =>
        log.error(s"HEL-947: backfillOutputNode failed for pipeline ${pipelineId.value}, node $nodeStepId", ex)
        Future.successful(())
      }

  /** The write half of `backfillOutputNode` — evaluates `targetStepId`'s rows via the same
   *  `backend.execute` prefix-walk `previewAtNode` uses (root-to-target path, following
   *  `parentStepId` back to the pipeline root, whichever branch the target sits on), but keeps
   *  every row (no `.take(10)`) and persists them via `nodeSnapshotRepo.overwriteRows` — the
   *  SAME per-node delete-then-insert-in-one-transaction write `onUnblockedRunSuccess` uses, so
   *  the no-cross-node-atomicity discipline is identical: this is one node's own transaction,
   *  never widened to cover any other node. Also refreshes every Output on this node's schema
   *  (mirrors `onUnblockedRunSuccess`'s per-Output `SchemaInferenceEngine` derivation) so a
   *  freshly-backfilled Output doesn't sit with an empty `schema: []` until the next real run. */
  private def evaluateNodeRowsForBackfill(pipelineId: PipelineId, targetStepId: Option[PipelineStepId], user: AuthenticatedUser, explicitRootId: Option[PipelineRootId]): Future[Unit] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(())
      case Some(pipeline) =>
        resolveAllRootDataSourcesInternal(pipelineId).flatMap {
          case roots if roots.isEmpty => Future.successful(())
          case allRoots if targetStepId.isEmpty =>
            // HEL-913 task 5.10: when a specific root is named, evaluate ONLY that root -- with
            // more than one root in `roots`, `backend.execute`'s `TreeWalkResult.rows` is always
            // the LOWEST-positioned root's frame (R10), so passing every root here would silently
            // backfill the wrong one whenever the Output is bound to a non-first root.
            val roots = explicitRootId match {
              case Some(rid) => allRoots.filter(_._1 == rid.value)
              case None      => allRoots
            }
            if (roots.isEmpty) Future.successful(())
            else backend
              // HEL-1108 (C11): threaded for uniformity only -- this arm executes with
              // Vector.empty steps (no step, hence no AI step, ever evaluates here).
              .execute(pipeline, roots, Vector.empty, dataSourceRepo, new AssertionSink, new TruncationSink,
                ownerUserId = Some(pipeline.ownerId.value))
              .flatMap(outcome => persistBackfilledRows(pipelineId, None, outcome.rows, explicitRootId))
              .recover { case ex =>
                logExecutionFailure(s"HEL-947: backfill source-level evaluation failed for pipeline ${pipelineId.value}", ex)
              }
          case roots =>
            val stepId = targetStepId.get.value
            pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
              allSteps.find(_.id.value == stepId) match {
                case None => Future.successful(())
                case Some(target) if !target.enabled => Future.successful(())
                case Some(target) =>
                  // HEL-970 (design.md D2): same shared closure helper as `previewStep` --
                  // no third, independently-authored notion of "depends on" survives here.
                  val slicedSteps = NodeDependencyClosure.closureOf(allSteps.toVector, target)
                  backend
                    .execute(pipeline, roots, slicedSteps.toVector, dataSourceRepo, new AssertionSink, new TruncationSink,
                      ownerUserId = Some(pipeline.ownerId.value))
                    .flatMap { outcome =>
                      val targetRows = outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)
                      // Step-bound write (`nodeKey = Some(stepId)`) -- `explicitRootId` only
                      // governs the ROOT-BOUND case (`persistBackfilledRows`'s own doc below),
                      // so `None` here is exactly correct, not a re-introduced silent default.
                      persistBackfilledRows(pipelineId, targetStepId, targetRows, explicitRootId = None)
                    }
                    .recover { case ex =>
                      logExecutionFailure(s"HEL-947: backfill evaluation failed for pipeline ${pipelineId.value}, step $stepId", ex)
                    }
              }
            }
        }
    }

  private def persistBackfilledRows(pipelineId: PipelineId, nodeKey: Option[PipelineStepId], rows: Seq[Map[String, Any]], explicitRootId: Option[PipelineRootId]): Future[Unit] = {
    val nodeJsRows = rows.map { rowMap =>
      JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
    }.toVector
    nodeSnapshotRepo.overwriteRows(pipelineId.value, nodeKey.map(_.value), nodeJsRows, explicitRootId.map(_.value)).flatMap { _ =>
      outputRepo.listByPipelineInternal(pipelineId).flatMap { outputs =>
        // HEL-913 task 5.10: a root-bound backfill (`nodeKey = None`) refreshes only the
        // Output(s) bound to THAT root when `explicitRootId` is named, not every root-bound
        // Output on the pipeline.
        val onThisNode = nodeKey match {
          case Some(_) => outputs.filter(_.node.stepId == nodeKey)
          case None    => outputs.filter(o => o.node.stepId.isEmpty && (explicitRootId.isEmpty || o.node.rootId == explicitRootId))
        }
        val inferredFields = SchemaInferenceEngine.inferShallowFromJsObjects(nodeJsRows)
        val schema = inferredFields.map(f => SchemaField(f.name, DataFieldType.asString(f.dataType))).toVector
        Future.sequence(onThisNode.map(o => outputRepo.updateSchemaInternal(o.id, schema))).map(_ => ())
      }
    }
  }
}
