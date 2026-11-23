package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.CreatePipelineRequest
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1638: the propose-time dry run of `PipelineService.create`'s pre-write checks for a request whose roots are
 *  already resolved to schemas. Writes nothing. Callers run [[preflight]], then resolve the root schemas (the charged
 *  fetches), then [[checkOutputs]]. Order mirrors `PipelineCreateWrites.checkedCreate`: request-only preflight
 *  ([[PipelineCreatePreflight.run]]), cross-owner/upsert ownership, then each Output's `fieldMapping` slot and
 *  column-at-node check through [[PipelineOutputSchemas]] -- the same functions `createTransactional` calls.
 *
 *  `rootSchemas(i)` is root i's schema as apply persists it (empty when an inline rest/sql fetch failed, with the connector
 *  error in `fetchErrors(i)`: apply keeps such a source, so acceptance is apply's exactly). */
private[services] final class PipelineCreateDryRun(dataSourceRepo: DataSourceRepository)(implicit ec: ExecutionContext) {

  /** Request-only preflight and cross-owner/upsert ownership, in `checkedCreate`'s order. `None` = no steps or Outputs
   *  (nothing to check). */
  def preflight(req: CreatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, Option[PipelineCreatePreflight.RootIndices]]] =
    if (req.steps.isEmpty && req.outputs.isEmpty) Future.successful(Right(None))
    else PipelineCreatePreflight.run(req) match {
      case Left(err) => Future.successful(Left(err))
      case Right(indices) =>
        PipelineStepOwnership.validateCrossOwnerRefs(dataSourceRepo, req.steps, user).map(_.map(_ => Some(indices)))
    }

  /** Each Output's `fieldMapping` slot and column-at-node check over the resolved root schemas. */
  def checkOutputs(
      req: CreatePipelineRequest,
      indices: PipelineCreatePreflight.RootIndices,
      rootSchemas: Vector[Vector[SchemaField]],
      fetchErrors: Map[Int, String],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    PipelineStepOwnership.resolveSecondarySourceSchemas(req.steps.map(s => s.`type` -> s.config.compactPrint), dataSourceRepo.findByIdOwned(_, user)).map { secondary =>
      val schemas = PipelineOutputSchemas.outputNodeSchemas(req.steps, indices.steps, rootSchemas, secondary)
      firstOutputProblem(req, indices, fetchErrors, schemas)
    }

  private def firstOutputProblem(
      req: CreatePipelineRequest,
      indices: PipelineCreatePreflight.RootIndices,
      fetchErrors: Map[Int, String],
      schemas: PipelineOutputSchemas.NodeSchemas
  ): Either[ServiceError, Unit] = {
    val stepIdx   = req.steps.map(_.clientId).zipWithIndex.toMap
    def rootOfStep(clientId: String): Option[Int] =
      stepIdx.get(clientId).flatMap { i =>
        val step = req.steps(i)
        step.parentStepId match {
          case Some(parent) => rootOfStep(parent)
          case None         => indices.steps(i)
        }
      }
    req.outputs.zip(indices.outputs).foldLeft[Either[ServiceError, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(()), (spec, rootIdx)) =>
        PipelineCreatePreflight.checkOutput(spec, stepIdx.keySet).flatMap { kind =>
          val owningRoot = spec.nodeStepClientId.flatMap(rootOfStep).orElse(rootIdx)
          PipelineOutputSchemas.outputMappingProblem(kind, spec.config.getOrElse(JsObject.empty), PipelineOutputSchemas.nodeSchemaOf(spec, rootIdx, schemas)).left.map {
            case err if owningRoot.exists(fetchErrors.contains) =>
              // The Output's node descends from a root whose live schema fetch failed: apply would say the columns are empty;
              // name the real cause instead. Acceptance is unchanged (this only rewords a rejection apply also makes).
              val i = owningRoot.get
              ServiceError.BadRequest(s"${PipelineService.rootAddress(i)}: could not read the source schema (${fetchErrors(i)}), so fieldMapping cannot be checked")
            case err => err
          }
        }
    }
  }
}
