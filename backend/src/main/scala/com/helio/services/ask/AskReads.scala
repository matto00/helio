package com.helio.services.ask

import com.helio.api.routes.dashboards.{PublicPanelOutputResolver, PublicPanelRowsResolver}
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, Page}
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.services.ServiceError
import com.helio.services.pipelines.{OutputHistoryPayload, OutputHistoryResolution, OutputHistoryService, OutputRowsQuery, OutputService}
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1745 D5: the data reads behind the tools. Every method here assumes the caller already re-checked scope for
 *  this call; none of them decides access. Dashboard rows go through the panel-scoped path the public rows route uses
 *  (a filter only on a binding panel's own controls); the Output path goes through `OutputService.rows`. */
class AskReads(
    outputRepo: OutputRepository,
    panelRepo: PanelRepository,
    nodeSnapshotRepo: NodeSnapshotRepository,
    outputService: OutputService,
    historyService: OutputHistoryService
)(implicit ec: ExecutionContext) {

  type Rows = (Vector[String], Vector[JsObject])

  /** The first binding panel (in panel order) whose controls admit the filter serves the read. */
  def dashboardRows(
      dashboardId: String,
      user: AuthenticatedUser,
      panels: Vector[OutputPanel],
      limit: Int,
      filter: Option[OutputRowsQuery.FilterParam]
  ): Future[Either[String, Rows]] = {
    val resolver = new PublicPanelRowsResolver(
      panelRepo, Some(user), outputRepo, Some(nodeSnapshotRepo), new PublicPanelOutputResolver(panelRepo, Some(user), outputRepo)
    )
    def attempt(rest: Vector[OutputPanel], last: String): Future[Either[String, Rows]] = rest.headOption match {
      case None => Future.successful(Left(last))
      case Some(panel) =>
        resolver.resolveRows(dashboardId, panel.id.value, Page(0, limit), None, filter).flatMap {
          case Right(r) =>
            val objects = r.items.collect { case o: JsObject => o }
            Future.successful(Right((r.columns, objects)))
          case Left(err) if filter.isEmpty => Future.successful(Left(err.message))
          case Left(_)                     => attempt(rest.tail, FilterNotOffered)
        }
    }
    attempt(panels, "No panel on this board shows that Output")
  }

  def outputRows(id: String, user: AuthenticatedUser, limit: Int, filter: Option[OutputRowsQuery.FilterParam]): Future[Either[String, Rows]] =
    outputService.rows(OutputId(id), Page(0, limit), user, None, filter).map {
      case Left(err) => Left(err.message)
      case Right(r)  => Right((r.columns, r.items.collect { case o: JsObject => o }))
    }

  /** When the Output's data was last recorded (its newest history point), else now for an Output with none. */
  def capturedAt(output: Output): Future[Instant] =
    historyService.forOutput(output, JsObject.empty, 1, None).map(_.current.map(_.capturedAt).getOrElse(Instant.now()))

  def history(output: Output, limit: Int, since: Option[Instant]): Future[OutputHistoryResolution] =
    outputRepo.findConfigsByIdsInternal(Vector(output.id.value)).flatMap { configs =>
      historyService.forOutput(output, configs.getOrElse(output.id.value, JsObject.empty), limit, since)
    }

  def payload(id: String, pointId: UUID, user: AuthenticatedUser): Future[Either[ServiceError, OutputHistoryPayload]] =
    historyService.payloadRows(OutputId(id), pointId, user)

  private val FilterNotOffered = "that filter column is not offered on this board; call again without a filter"
}

