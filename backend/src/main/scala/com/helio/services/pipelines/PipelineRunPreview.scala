package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{OutputPreviewEntry, PipelinePreviewResponse, RunResultResponse}
import com.helio.domain.model.{AssertionSink, AuthenticatedUser, OutputId, PipelineId, TruncationSink}
import com.helio.domain.engine.{NodeDependencyClosure, PipelineCostEstimator, PipelineExecutionBackend, PipelineRowJson, StepKey}
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json._
import scala.concurrent.{ExecutionContext, Future}

/** Read-only dry-run previews (step, Output, source-level). Split out of `PipelineRunService` (HEL-1393). */
private[pipelines] final class PipelineRunPreview(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    outputRepo: OutputRepository,
    backend: PipelineExecutionBackend,
    support: PipelineRunSupport
)(implicit ec: ExecutionContext) {

  import support.{executionFailureError, logExecutionFailure, resolveAllRootDataSourcesInternal, truncationFields}

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
   *  `PipelineRunExecutor.executeRun`, never from here) -- verified by
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
   *  `PipelineRunBackfill.evaluateNodeRowsForBackfill`'s handling of the identical mismatch -- it does NOT
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
            // "every root, every Output" guarantee, which only governs `PipelineRunExecutor.executeRun`.
            //
            // HEL-913 (evaluation-2.md item 2): a NAMED `rootId` that does not resolve among
            // `roots` FAILS CLOSED (a named error) rather than silently falling back to
            // `roots.head` -- matches `PipelineRunBackfill.evaluateNodeRowsForBackfill`'s handling of the
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
}
