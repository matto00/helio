package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.model.{DataSourceId, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1639 D2: the schema a SAVED pipeline node projects, for checking an Output's `fieldMapping` before the Output
 *  exists. It runs the same symbolic walk analyze runs (`PipelineAnalyzeService.analyzeNodes`) over ALL saved steps with
 *  their `enabled` flag, so a disabled step is transparent exactly as analyze treats it (it deliberately does NOT copy
 *  `PipelineNodeReads.projectedSchemaAtNode`, which drops disabled steps). Root and secondary source schemas are read
 *  with the pipeline OWNER's view (the HEL-1516 precedent), so an editor who does not own a source is never told a
 *  column is missing that the owner can see. */
private[services] object PipelineNodeSchemas {

  /** `Left(message)` when `nodeStepId` is not a step of `pipelineId`, or the walk cannot reach it. */
  def schemaAtNode(
      pipelineId: PipelineId,
      ownerId: UserId,
      nodeStepId: PipelineStepId,
      pipelineRepo: PipelineRepository,
      pipelineStepRepo: PipelineStepRepository,
      dataSourceRepo: DataSourceRepository
  )(implicit ec: ExecutionContext): Future[Either[String, Vector[SchemaField]]] =
    pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { steps =>
      if (!steps.exists(_.id == nodeStepId))
        Future.successful(Left(s"nodeStepId '${nodeStepId.value}' is not a step of pipeline ${pipelineId.value}"))
      else
        for {
          roots        <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
          rootIdOfStep <- pipelineStepRepo.rootIdsOf(pipelineId)
          rootSchemas  <- Future.traverse(roots) { case (rootId, dsId) =>
                            dataSourceRepo.findByIdOwnedByInternal(dsId, ownerId).map(ds => rootId.value -> ds.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
                          }
          encoded       = steps.map(s => s.kind -> PipelineStepConfigCodec.encode(s))
          secondaryIds  = encoded.flatMap { case (op, config) => PipelineAnalyzeService.secondarySourceIdOf(op, config) }.distinct
          secondary    <- Future.traverse(secondaryIds)(id => dataSourceRepo.findByIdOwnedByInternal(DataSourceId(id), ownerId).map(id -> _.map(_.inferredSchema).filter(_.nonEmpty)))
        } yield {
          val inputs = steps.map { s =>
            PipelineAnalyzeService.NodeStepInput(
              id = s.id.value, parentStepId = s.parentStepId.map(_.value), position = s.position, op = s.kind,
              config = PipelineStepConfigCodec.encode(s), rootId = rootIdOfStep.get(s.id).map(_.value), enabled = s.enabled
            )
          }
          val projected = PipelineAnalyzeService.analyzeNodes(inputs, rootSchemas.toMap, secondary.collect { case (id, Some(sc)) => id -> sc }.toMap)
          projected.get(nodeStepId.value).map(_.outputSchema).toRight(s"could not resolve the schema at step '${nodeStepId.value}'")
        }
    }
}
