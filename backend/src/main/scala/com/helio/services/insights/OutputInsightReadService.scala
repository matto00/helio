package com.helio.services.insights

import com.helio.domain.insights.OutputInsightRecord
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind}
import com.helio.infrastructure.persistence.pipelines.OutputInsightRepository
import com.helio.services.ServiceError

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** The newest `ok` render and the newest attempt of any status, both null when none. `privileged` is true for the pipeline owner
 *  and editor grantees: they see cost fields and the real attempt status and may refresh; a viewer does not (HEL-1743 R3/R3b). */
final case class OutputInsightRead(render: Option[OutputInsightRecord], lastAttempt: Option[OutputInsightRecord], privileged: Boolean)

/** One page of history, with the same role flag. */
final case class OutputInsightHistory(items: Vector[OutputInsightRecord], privileged: Boolean)

/** HEL-1742: the read side of the insight render store. Reads never create, regenerate or modify a
 *  render, and the constructor deliberately takes only the insight repository and the ACL helper:
 *  no model client, renderer, or service that holds one (`OutputService` reaches a live `AiStepClient`
 *  through `PipelineRunService`) is reachable from here. `OutputInsightReadServiceShapeSpec` pins
 *  that parameter list exactly. HEL-1743 D8 added [[InsightAccess]] (an `OutputRepository` and an `AccessChecker`, no model). */
final class OutputInsightReadService(
    insightRepo: OutputInsightRepository,
    access: InsightAccess
)(implicit ec: ExecutionContext) {

  /** Authorizes through the sharing-aware `findById`: an unknown id, a no-access id and an Output
   *  that is not an `insight` are all the same `NotFound`. */
  def read(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, OutputInsightRead]] =
    access.resolve(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, acc)) =>
        for {
          ok      <- insightRepo.latestOk(id.value)
          attempt <- insightRepo.latestAttempt(id.value)
        } yield {
          val privileged = InsightAccess.isPrivileged(acc)
          Right(OutputInsightRead(ok.map(shape(_, privileged)), attempt.map(shape(_, privileged)), privileged))
        }
    }

  def history(id: OutputId, user: AuthenticatedUser, limit: Int, since: Option[Instant]): Future[Either[ServiceError, OutputInsightHistory]] =
    access.resolve(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, acc)) =>
        val privileged = InsightAccess.isPrivileged(acc)
        insightRepo.listRecent(id.value, limit, since).map(items => Right(OutputInsightHistory(items.map(shape(_, privileged)), privileged)))
    }

  /** No ACL: the caller must already have authorized access to `output` (the public route does so
   *  through its dashboard gate). `None` for a non-insight kind. */
  def latestOkFor(output: Output): Future[Option[Option[OutputInsightRecord]]] =
    if (output.kind != OutputKind.Insight) Future.successful(None)
    else insightRepo.latestOk(output.id.value).map(Some(_))

  /** The owner and editors see the stored record; a viewer sees [[OutputInsightRecord.forViewer]]. */
  private def shape(r: OutputInsightRecord, privileged: Boolean): OutputInsightRecord = if (privileged) r else r.forViewer
}
