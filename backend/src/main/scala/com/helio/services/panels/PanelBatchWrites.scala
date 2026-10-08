package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{CreatePanelRequest, CreatePanelsBatchRequest, PanelBatchItem}
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.panels.PanelServiceHelpers._
import org.slf4j.LoggerFactory
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** The post-ACL bodies of `PanelService.batchUpdate` / `batchCreate`, split out of `PanelService`.
 *  Every ACL / `Forbidden` / 404 preamble stays in `PanelService`; `audit` is `PanelService`'s own
 *  (a no-op when no `AuditService` is wired). */
private[panels] final class PanelBatchWrites(
    panelRepo:          PanelRepository,
    bindingChecks:      PanelBindingChecks,
    createBuilder:      PanelCreateBuilder,
    batchControlsCheck: BatchControlsCheck,
    audit:              (String, Option[String], AuthenticatedUser, JsValue) => Unit
)(implicit ec: ExecutionContext) {

  import bindingChecks._
  import createBuilder._

  // Same logger category as `PanelService` (the `batchUpdate` failure log predates this split).
  private val log = LoggerFactory.getLogger(classOf[PanelService])

  def updateValidated(
      items: Vector[PanelBatchItem],
      panels: Vector[Panel],
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    // D5 — validate every item's chartType before the transactional
    // write so an invalid value rejects the whole batch (no partial
    // write). This is the path the live edit UI uses.
    val batchValidation = for {
      _ <- validateBatchTypeMatch(items.zip(panels))
      _ <- validateBatchChartTypes(items)
    } yield ()
    batchValidation match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        val now = Instant.now()
        batchControlsCheck(items.zip(panels), user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => panelRepo.batchUpdate(items, now)
          .map { updated =>
            // HEL-477 design.md Decision 9: one panel.batch_update
            // row per call, not one per panel.
            audit(
              "panel.batch_update",
              Some(dashboardId.value),
              user,
              JsObject("count" -> JsNumber(updated.size), "panelIds" -> JsArray(updated.map(p => JsString(p.id.value))))
            )
            Right(updated)
          }
          .recover { case ex =>
            // HEL-311: never echo a raw DB-failure message; log
            // the detail server-side and return a generic body.
            log.error(s"batchUpdate failed for dashboard ${dashboardId.value}", ex)
            Left(ServiceError.BadRequest("Batch update failed"))
          }
        }
    }
  }

  def createValidated(
      request: CreatePanelsBatchRequest,
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[(Panel, PlacedLayouts)]]] = {
    val items = request.panels
    val createRequests = items.map { item =>
      CreatePanelRequest(
        dashboardId = Some(dashboardId.value),
        title       = item.title,
        `type`      = item.`type`,
        config      = item.config,
        appearance  = item.appearance
      )
    }
    val itemLabel: Int => Option[String] =
      idx => Some(s"panel ${idx + 1} ('${items(idx).title.getOrElse("")}')")
    buildAllForCreate(dashboardId, createRequests, user, itemLabel).flatMap {
      case Left(err)     => Future.successful(Left(err))
      case Right(built)  =>
        Future.traverse(built)(p => defaultSizesFor(p).map(p -> _))
          .flatMap(panelRepo.insertBatchPlaced)
          .map {
            case None => Left(ServiceError.NotFound("Dashboard not found"))
            case Some(inserted) =>
              // HEL-477 design.md Decision 9: one panel.batch_create row
              // per call, not one per panel.
              audit(
                "panel.batch_create",
                Some(dashboardId.value),
                user,
                JsObject("count" -> JsNumber(inserted.size), "panelIds" -> JsArray(inserted.map { case (p, _) => JsString(p.id.value) }))
              )
              Right(inserted)
          }
    }
  }
}
