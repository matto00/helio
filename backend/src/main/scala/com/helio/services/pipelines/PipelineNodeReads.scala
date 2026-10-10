package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.api.protocols.pipelines.{ExpressionValidationResponse, NodeCapabilitiesResponse}
import com.helio.api.protocols.pipelines.PipelineLaneTreeNode
import com.helio.api.protocols.panels.{PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, DataSourceId, Output, OutputKind, Pipeline, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.{ExpressionEvaluator, PipelineAnalyzeService, RuntimeGraphPath, SchemaField}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Per-node reads: the lane tree, node capabilities, expression validation and the `private[services]` batched lookups. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineNodeReads(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    outputRepo: OutputRepository,
    support: PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  import support.resolveSecondarySourceSchemas

  /** HEL-914 task 6.6 (design.md D5/D6): the compact lane tree `WorkspaceContextService`
   *  embeds per pipeline -- id/parentId/rootId/op/boundOutputIds, no configs, no schemas, no
   *  sample rows. `rootId` reuses `RuntimeGraphPath` (never a second root-resolution walk);
   *  bound Outputs come from the SAME `outputRepo.listByPipelineInternal` fetch
   *  `WorkspaceContextService.buildPipeline` already makes for its representative-Output pick,
   *  so this adds no new query shape to that caller, only a second, cheap in-memory grouping
   *  over already-fetched rows. */
  def laneTree(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineLaneTreeNode]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
          val outputsF = outputRepo.listByPipelineInternal(pipelineId)
          outputsF.flatMap(outputs => laneTreeGiven(pipelineId, allSteps, outputs)).map(Right(_))
        }
    }

  /** Performance fix (HEL-914, CI diagnosis): the SAME lane-tree computation `laneTree` above
   *  performs, but skipping its ownership check (`findByIdShared`) and its own steps/Outputs
   *  fetches -- for a caller that has ALREADY established ownership and ALREADY fetched both in
   *  the SAME request. `WorkspaceContextService.buildPipeline` is exactly this caller: it already
   *  confirmed ownership via the owner-scoped `listSummaries` call that produced its `summary`,
   *  and it already fetches this pipeline's Outputs for its own `outputsF`. Before this fix,
   *  `buildPipeline`'s per-pipeline cost carried THREE genuinely redundant round trips —
   *  `findByIdShared` (ownership re-check), `outputRepo.listByPipelineInternal` (byte-identical to
   *  `outputsF`), and (via `analyzeF`'s own `pipelineService.analyze` call) a second copy of this
   *  same pipeline's steps — a real N+1 regardless of any test's time budget, not merely a
   *  CI-timeout workaround; the spec's own `beforeEach`-free 32-pipeline fixture just makes it
   *  visible at ~1.4x. `laneTree` (the PUBLIC, ACL-checked entry point) is UNCHANGED for every
   *  other caller — this method is deliberately `private[services]`, named to state exactly what
   *  it assumes (steps/outputs GIVEN, not re-derived) rather than accepting a bare boolean that
   *  would silently invite a future caller to skip the ACL check without having actually done
   *  one (design.md's HEL-384 near-miss is the precedent this naming exists to avoid repeating). */
  private[services] def laneTreeGiven(
      pipelineId: PipelineId,
      allSteps: Vector[PipelineStep],
      outputsAlreadyFetchedForThisPipeline: Vector[Output]
  ): Future[Vector[PipelineLaneTreeNode]] = {
    val rootFetch = for {
      rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
      rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
    } yield (rootDataSourceIds.map(_._1.value), rootIdOfStep)

    rootFetch.map { case (rootIds, rootIdOfStep) =>
      laneTreeFromRoots(allSteps, outputsAlreadyFetchedForThisPipeline, rootIds, rootIdOfStep)
    }
  }

  /** Multi-pipeline performance fix (HEL-914 follow-up, production fix -- HEL-865's field report
   *  recorded `GET /api/workspace/context` returning 220,197 characters on a 25-source/
   *  43-pipeline workspace, independent of any test's time budget): the per-pipeline-loop callers
   *  of [[laneTreeGiven]] (`WorkspaceContextService.buildPipeline`, fanned out via
   *  `Future.traverse` in `assemble`) were still issuing `pipelineRepo.listRootDataSourceIdsInternal`
   *  and `pipelineStepRepo.rootIdsOf` ONE PIPELINE AT A TIME -- 2 round trips per pipeline, 2N per
   *  request. This variant takes those two lookups as ALREADY-BATCHED, already-sliced-to-this-
   *  pipeline arguments (see `PipelineRepository.listRootDataSourceIdsInternalBatch` /
   *  `PipelineStepRepository.rootIdsOfBatch`, and `WorkspaceContextService.assemble`'s single
   *  batched fetch across every summary the caller owns), so the DB cost collapses to 2 queries
   *  for the WHOLE request. Pure/in-memory -- no `Future`, no ownership check of its own, mirroring
   *  `laneTreeGiven`'s own "assumes ownership already established by the caller" contract; the only
   *  caller (`WorkspaceContextService.buildPipeline`) derives its batched maps from the SAME
   *  owner-scoped `listSummaries` result that already gates `laneTreeGiven`. */
  /** Thin delegation to `PipelineRepository.listRootDataSourceIdsInternalBatch` -- exists so
   *  `WorkspaceContextService` (which holds a `PipelineService`, not a `PipelineRepository`)
   *  can reach the batched lookup without a new constructor dependency. See that method's own
   *  doc for the privileged/caller-must-already-own-these-ids contract this inherits unchanged. */
  private[services] def listRootDataSourceIdsInternalBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Vector[(PipelineRootId, DataSourceId)]]] =
    pipelineRepo.listRootDataSourceIdsInternalBatch(pipelineIds)

  /** Thin delegation to `PipelineStepRepository.rootIdsOfBatch` -- same rationale as
   *  [[listRootDataSourceIdsInternalBatch]] above. */
  private[services] def rootIdsOfBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Map[PipelineStepId, PipelineRootId]]] =
    pipelineStepRepo.rootIdsOfBatch(pipelineIds)

  /** Thin delegation to `PipelineStepRepository.listByPipelineInternalBatch` -- same rationale as
   *  [[listRootDataSourceIdsInternalBatch]] above. Exists ONLY for `WorkspaceContextService`'s
   *  lane-tree fetch; `analyze` keeps its own separate, unbatched steps fetch unchanged. */
  private[services] def listByPipelineInternalBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Vector[PipelineStep]]] =
    pipelineStepRepo.listByPipelineInternalBatch(pipelineIds)

  private[services] def laneTreeFromRoots(
      allSteps: Vector[PipelineStep],
      outputsAlreadyFetchedForThisPipeline: Vector[Output],
      rootDataSourceIds: Vector[String],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId]
  ): Vector[PipelineLaneTreeNode] = {
    val rootIdOfStepStr = rootIdOfStep.map { case (sid, rid) => sid.value -> rid.value }
    val graphPath       = RuntimeGraphPath.build(allSteps, rootDataSourceIds, rootIdOfStepStr)
    val outputsByStep: Map[String, Vector[String]] =
      outputsAlreadyFetchedForThisPipeline.flatMap(o => o.node.stepId.map(sid => sid.value -> o.id.value)).groupMap(_._1)(_._2)
    allSteps.map { s =>
      val path   = graphPath.pathOf(s)
      val rootId = path.stripPrefix("root:").takeWhile(_ != ' ')
      PipelineLaneTreeNode(
        id        = s.id.value,
        parentId  = s.parentStepId.map(_.value),
        rootId    = rootId,
        op        = s.kind,
        outputIds = outputsByStep.getOrElse(s.id.value, Vector.empty)
      )
    }
  }

  /** `GET /api/pipelines/:id/capabilities?stepId=` (HEL-906 task 3.4) — evaluates
   *  `OutputBindingSpec` against the per-node projection `PipelineAnalyzeService.analyzeNodes`
   *  (task 3.3) computes for `stepId`, `None` meaning the pipeline's raw source. Sharing-aware
   *  read (owner/editor/viewer of the pipeline), mirroring `analyze` above. An unresolvable
   *  `stepId` (absent from the pipeline's own step list, or present but unreached by the tree
   *  walk) is a 404 naming the id -- never a silent fallback to the source schema. */
  def capabilitiesAtNode(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, NodeCapabilitiesResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        projectedSchemaAtNode(pipelineId, pipeline, stepId, user).map {
          case None =>
            Left(ServiceError.NotFound(s"Unknown stepId: ${stepId.map(_.value).getOrElse("")}"))
          case Some(schema) =>
            Right(buildNodeCapabilities(stepId, schema))
        }
    }

  /** `POST /api/pipelines/:id/validate-expression?stepId=` (HEL-906 cycle 7): delegates to
   *  the SAME `ExpressionEvaluator.validate` the `compute` step's own analyze-time hook uses
   *  (`PipelineAnalyzeService.inferCompute`), against the node's projected schema field names
   *  -- reuses `capabilitiesAtNode`'s node-resolution machinery (`projectedSchemaAtNode`)
   *  rather than a second schema-projection codepath. `stepId` absent means the pipeline's
   *  raw source schema. An unknown `stepId` is a 404, matching `capabilitiesAtNode`'s own
   *  convention. */
  def validateExpression(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      expression: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, ExpressionValidationResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        projectedSchemaAtNode(pipelineId, pipeline, stepId, user).map {
          case None =>
            Left(ServiceError.NotFound(s"Unknown stepId: ${stepId.map(_.value).getOrElse("")}"))
          case Some(schema) =>
            val fieldNames = schema.map(_.name).toSet
            ExpressionEvaluator.validate(expression, fieldNames) match {
              case Right(())  => Right(ExpressionValidationResponse(valid = true, error = None))
              case Left(msg)  => Right(ExpressionValidationResponse(valid = false, error = Some(msg)))
            }
        }
    }

  /** Shared node-schema-projection resolution for `capabilitiesAtNode`/`validateExpression` --
   *  `None` (outer) means an unknown `stepId`; `Some(sourceSchema)` when `stepId` is absent. */
  private def projectedSchemaAtNode(
      pipelineId: PipelineId,
      pipeline: Pipeline,
      stepId: Option[PipelineStepId],
      user: AuthenticatedUser
  ): Future[Option[Vector[SchemaField]]] =
    pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
      // HEL-913 task 5.9: `pipeline.sourceDataSourceId` no longer exists -- resolved via EVERY
      // pipeline root (not just the lowest-positioned one), each root's schema keyed by its own
      // root id so a root-level node's projection uses THAT root's schema, not an arbitrary
      // "the" root. `rootIdsOf` gives each parentless step's owning root; `stepId absent` (the
      // caller asking for "the source schema") still resolves against the lowest-positioned
      // root, matching the pre-multi-root single-schema convention `stepId = None` has always had
      // on this endpoint (caller's pipeline access already confirmed upstream, mirroring the
      // privileged field-read `listRootDataSourceIdsInternal`, which replaced the single-root
      // primary-source resolution).
      for {
        rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
        rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
        schemasByRoot     <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                               dataSourceRepo.findByIdOwned(dsId, user).map(ds => rootId.value -> ds.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
                             }.map(_.toMap)
        secondarySchemas  <- resolveSecondarySourceSchemas(allSteps.filter(_.enabled).map(s => s.kind -> PipelineStepConfigCodec.encode(s)), dataSourceRepo.findByIdInternal)
      } yield {
        val primarySchema = rootDataSourceIds.headOption.map(_._1.value).flatMap(schemasByRoot.get).getOrElse(Vector.empty[SchemaField])
        val steps = allSteps.filter(_.enabled)
        val nodeInputs = steps.map(s =>
          PipelineAnalyzeService.NodeStepInput(
            id           = s.id.value,
            parentStepId = s.parentStepId.map(_.value),
            position     = s.position,
            op           = s.kind,
            config       = PipelineStepConfigCodec.encode(s),
            rootId       = rootIdOfStep.get(s.id).map(_.value)
          )
        )
        val projections = PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, secondarySchemas)
        stepId match {
          case None      => Some(primarySchema)
          case Some(sid) => projections.get(sid.value).map(_.outputSchema)
        }
      }
    }

  private def buildNodeCapabilities(stepId: Option[PipelineStepId], schema: Vector[SchemaField]): NodeCapabilitiesResponse = {
    val columns = schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => PanelCapabilityColumnResponse(sf.name, DataFieldType.asString(t), nullable = false)))
    val capabilities = OutputBindingSpec.All.map { spec =>
      val result = OutputBindingSpec.evaluate(spec, schema)
      OutputKind.asString(spec.outputKind) -> PanelCapabilityResponse(
        bindable        = result.bindable,
        requiredSlots   = spec.requiredSlots,
        optionalSlots   = spec.optionalSlots,
        eligibleColumns = result.eligibleColumns,
        reason          = result.reason,
        message         = result.message
      )
    }.toMap
    NodeCapabilitiesResponse(stepId.map(_.value), columns, capabilities)
  }
}
