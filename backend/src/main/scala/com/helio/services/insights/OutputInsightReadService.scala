package com.helio.services.insights

import com.helio.domain.insights.OutputInsightRecord
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind}
import com.helio.infrastructure.persistence.pipelines.{OutputInsightRepository, OutputRepository}
import com.helio.services.ServiceError

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** The newest `ok` render and the newest attempt of any status, both null when none. */
final case class OutputInsightRead(render: Option[OutputInsightRecord], lastAttempt: Option[OutputInsightRecord])

/** HEL-1742: the read side of the insight render store. Reads never create, regenerate or modify a
 *  render, and the constructor deliberately takes only the two DB-backed repositories: no model
 *  client, renderer, or service that holds one (`OutputService` reaches a live `AiStepClient`
 *  through `PipelineRunService`) is reachable from here. `OutputInsightReadServiceShapeSpec` pins
 *  that parameter list exactly. */
final class OutputInsightReadService(
    outputRepo: OutputRepository,
    insightRepo: OutputInsightRepository
)(implicit ec: ExecutionContext) {

  /** Authorizes through the sharing-aware `findById`: an unknown id, a no-access id and an Output
   *  that is not an `insight` are all the same `NotFound`. */
  def read(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, OutputInsightRead]] =
    authorized(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        for {
          ok      <- insightRepo.latestOk(id.value)
          attempt <- insightRepo.latestAttempt(id.value)
        } yield Right(OutputInsightRead(ok, attempt))
    }

  def history(id: OutputId, user: AuthenticatedUser, limit: Int, since: Option[Instant]): Future[Either[ServiceError, Vector[OutputInsightRecord]]] =
    authorized(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => insightRepo.listRecent(id.value, limit, since).map(Right(_))
    }

  /** No ACL: the caller must already have authorized access to `output` (the public route does so
   *  through its dashboard gate). `None` for a non-insight kind. */
  def latestOkFor(output: Output): Future[Option[Option[OutputInsightRecord]]] =
    if (output.kind != OutputKind.Insight) Future.successful(None)
    else insightRepo.latestOk(output.id.value).map(Some(_))

  private def authorized(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, Output]] =
    outputRepo.findById(id, user).map {
      case Some(o) if o.kind == OutputKind.Insight => Right(o)
      case _                                       => Left(ServiceError.NotFound("Output not found"))
    }
}
