package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.DraftPreviewRequest
import com.helio.domain.model.{PipelineId, PipelineStep}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository.PipelineStepRow
import com.helio.services.ServiceError

import java.time.Instant
import scala.util.{Failure, Success, Try}

/** HEL-1630 design.md D2: request steps -> domain steps, through the repository's own pure `domainOf` so a draft decodes
 *  exactly like a stored step. An unknown kind or undecodable config is a `400` naming the step, never the failure's own text
 *  (which can quote the config). The result is in request order. */
object DraftPreviewStepDecoder {

  def decode(stepRepo: PipelineStepRepository, pipelineId: PipelineId, req: DraftPreviewRequest): Either[ServiceError, Vector[PipelineStep]] = {
    val now = Instant.now()
    val rows = req.steps.map { s =>
      PipelineStepRow(s.id, pipelineId.value, s.position, s.kind, s.config.compactPrint, s.enabled, now, now, s.parentStepId, s.rootId)
    }
    Try(stepRepo.domainOf(rows)) match {
      case Success(ordered) if ordered.size == rows.size =>
        val byId = ordered.map(s => s.id.value -> s).toMap
        Right(req.steps.map(s => byId(s.id)))
      case Success(_) => Left(ServiceError.BadRequest("Step parents form a cycle"))
      case Failure(_) =>
        val offender = rows.find(r => Try(stepRepo.domainOf(Vector(r.copy(parentStepId = None, rootId = Some("r"))))).isFailure)
        Left(ServiceError.BadRequest(s"Step '${offender.map(_.id).getOrElse("?")}' has an unknown kind or a config that does not decode"))
    }
  }
}
