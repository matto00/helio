package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftSaveProtocol, OutputResponse, PipelineStepResponse}
import com.helio.domain.model.PipelineId
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineStepRepository}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.ExecutionContext

/** The steps and Outputs of one pipeline as wire responses, read as composable `DBIO`s so the save returns exactly what it
 *  wrote and `GET /api/pipelines/:id?definition=true` returns them from the SAME snapshot as the fingerprint (HEL-1629). */
private[draft] final class DraftDefinitionReads(
    stepRepo: PipelineStepRepository,
    outputRepo: OutputRepository
)(implicit ec: ExecutionContext) extends DraftSaveProtocol {

  def definition(pipelineId: PipelineId): DBIO[(Vector[PipelineStepResponse], Vector[OutputResponse])] =
    for {
      stepsAndRoots <- stepRepo.listWithRootIdsAction(pipelineId)
      outs          <- outputRepo.listByPipelineAction(pipelineId)
      configs       <- outputRepo.findConfigsByIdsAction(outs.map(_.id.value))
    } yield {
      val rootOf = stepsAndRoots._2.map { case (step, root) => step.value -> root.value }
      (
        stepsAndRoots._1.map(PipelineStepResponse.fromDomain(_, rootOf)),
        outs.map(o => outputResponseFrom(o, configs.getOrElse(o.id.value, JsObject.empty)))
      )
    }

  /** `{steps, outputs}` for the pipeline summary's `definition` field. */
  def json(steps: Vector[PipelineStepResponse], outputs: Vector[OutputResponse]): JsObject =
    JsObject("steps" -> JsArray(steps.map(pipelineStepResponseFormat.write)), "outputs" -> JsArray(outputs.map(outputResponseFormat.write)))
}
