package com.helio.services.dashboards

import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{DashboardSnapshotPayload, DashboardSnapshotPanelEntry}
import com.helio.domain.model._
import com.helio.domain.panels.PanelConfigCodec
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.dashboards.DashboardServiceValidation._
import com.helio.services.panels.PanelServiceHelpers
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** The body of `DashboardService.importSnapshot` and its per-panel pre-write validation, split out
 *  of `DashboardService` (HEL-1234). `audit` is `DashboardService`'s own (a no-op when no
 *  `AuditService` is wired). */
private[dashboards] final class DashboardSnapshotImport(
    dashboardRepo: DashboardRepository,
    outputRepo:    OutputRepository,
    audit:         (String, Option[String], AuthenticatedUser, JsValue) => Unit
)(implicit ec: ExecutionContext) {

  def importSnapshot(
      payload: DashboardSnapshotPayload,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    validateSnapshotPayload(payload) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right(_) =>
        validateImportPanels(payload, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            dashboardRepo.importSnapshot(repairImportedLayoutGeometry(payload), user.id).map { case value @ (dashboard, panels) =>
              // HEL-477 design.md Decision 9: a distinct dashboard.import action
              // (not dashboard.create) — one row, no per-panel events.
              audit(
                "dashboard.import",
                Some(dashboard.id.value),
                user,
                JsObject("panelCount" -> JsNumber(panels.size))
              )
              Right(value)
            }
        }
    }

  /** HEL-910 task 2.1/2.2 (design.md Decision 5). Two checks per entry, both BEFORE any repo
   *  write so `DashboardSnapshotRepository.importSnapshot`'s own construction/id-minting logic
   *  never runs on a payload this rejects:
   *   - Gap B: decode `entry.config` via `PanelConfigCodec.decodeCreateConfig`, build the typed
   *     `Panel` via `PanelServiceHelpers.buildNewPanel`, and call the panel's own
   *     `.validateConfig` (the same method `PanelService.buildForCreate` calls) plus the
   *     appearance decode/validate path (`PanelServiceHelpers.resolveCreateAppearance`) — closes
   *     HEL-628 (import previously skipped both).
   *   - Gap A: for an output-kind panel, confirm the bound `outputId` actually resolves via
   *     `outputRepo.findByIdOwned`.
   *  Returns the first failing entry's error, labelled with its `snapshotId` (mirrors
   *  `validatePanelEntries`'s own labelling convention). */
  private def validateImportPanels(
      payload: DashboardSnapshotPayload,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] = {
    def validateOne(entry: DashboardSnapshotPanelEntry): Future[Either[ServiceError, Unit]] = {
      val built = for {
        createConfig <- PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config))
        appearance   <- PanelServiceHelpers.resolveCreateAppearance(Some(entry.appearance))
      } yield (createConfig, appearance)

      built match {
        case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"panel '${entry.snapshotId}': $msg")))
        case Right((createConfig, appearance)) =>
          val now = Instant.now()
          val panel = PanelServiceHelpers.buildNewPanel(
            id           = PanelId(UUID.randomUUID().toString),
            dashboardId  = DashboardId(""),
            title        = entry.title,
            meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
            appearance   = appearance,
            ownerId      = user.id,
            createConfig = createConfig
          )
          panel.validateConfig match {
            case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"panel '${entry.snapshotId}': $msg")))
            case Right(_) =>
              PanelServiceHelpers.outputIdFromCreateConfig(createConfig) match {
                case Some(outputId) =>
                  outputRepo.findByIdOwned(outputId, user).map {
                    case None    => Left(ServiceError.BadRequest(s"panel '${entry.snapshotId}': outputId '${outputId.value}' not found"))
                    case Some(_) => Right(())
                  }
                case _ => Future.successful(Right(()))
              }
          }
      }
    }

    payload.panels.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, entry) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(_)  => validateOne(entry)
      }
    }
  }
}
