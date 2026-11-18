package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftSaveProtocol, OutputResponse, PipelineRootSummaryResponse, PipelineStepResponse}
import com.helio.domain.model.PipelineId
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.ExecutionContext

/** The steps and Outputs of one pipeline as wire responses, read as composable `DBIO`s so the save returns exactly what it
 *  wrote and `GET /api/pipelines/:id?definition=true` returns them from the SAME snapshot as the fingerprint (HEL-1629). */
private[draft] final class DraftDefinitionReads(
    stepRepo: PipelineStepRepository,
    outputRepo: OutputRepository,
    pipelineRepo: PipelineRepository
)(implicit ec: ExecutionContext) extends DraftSaveProtocol {

  /** The steps, Outputs and (HEL-1734) roots of one pipeline, roots in position order. */
  def definition(pipelineId: PipelineId): DBIO[(Vector[PipelineStepResponse], Vector[OutputResponse], Vector[PipelineRootSummaryResponse])] =
    for {
      roots         <- pipelineRepo.rootsAction(pipelineId)
      stepsAndRoots <- stepRepo.listWithRootIdsAction(pipelineId)
      outs          <- outputRepo.listByPipelineAction(pipelineId)
      configs       <- outputRepo.findConfigsByIdsAction(outs.map(_.id.value))
    } yield {
      val rootOf = stepsAndRoots._2.map { case (step, root) => step.value -> root.value }
      (
        stepsAndRoots._1.map(PipelineStepResponse.fromDomain(_, rootOf)),
        outs.map(o => outputResponseFrom(o, configs.getOrElse(o.id.value, JsObject.empty))),
        roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName))
      )
    }

  /** `{steps, outputs}` for the pipeline summary's `definition` field. */
  def json(steps: Vector[PipelineStepResponse], outputs: Vector[OutputResponse]): JsObject =
    JsObject("steps" -> JsArray(steps.map(pipelineStepResponseFormat.write)), "outputs" -> JsArray(outputs.map(outputResponseFormat.write)))
}
