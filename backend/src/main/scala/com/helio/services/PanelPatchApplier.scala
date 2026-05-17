package com.helio.services

import com.helio.domain._
import com.helio.domain.panels.PanelConfigCodec
import com.helio.infrastructure.PanelRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Applies a validated patch to a panel by composing per-field repository
 *  updates. Lives next to `PanelService` so the patch resolver and applier
 *  are colocated, but split into its own file to keep `PanelService.scala`
 *  inside the 300-line service budget.
 *
 *  CS2c-3c composition order: title → appearance → config (typed). The
 *  cross-type 400 lock is enforced at the service layer (see
 *  `PanelService.resolvePatch`) so by the time we reach this applier any
 *  request `type` matches the stored panel's `kind` — `type` itself is
 *  therefore a no-op at the repo layer (the row already has the correct
 *  `type` column). Typed `config` patches are applied per-subtype via
 *  [[PanelConfigCodec.applyConfigPatch]] and persisted as one JSON column. */
private[services] final class PanelPatchApplier(panelRepo: PanelRepository)(implicit ec: ExecutionContext) {

  def apply(
      panelId: PanelId,
      spec: ResolvedPanelPatch,
      resolveBinding: Panel => Future[Panel]
  ): Future[Option[Panel]] = {
    val now = Instant.now()

    def applyTitle(panel: Panel): Future[Option[Panel]] =
      spec.trimmedTitle match {
        case None        => Future.successful(Some(panel))
        case Some(title) => panelRepo.updateTitle(panelId, title, now)
      }

    def applyAppearance(panelOpt: Option[Panel]): Future[Option[Panel]] =
      spec.appearance match {
        case None         => Future.successful(panelOpt)
        case Some(appearance) => panelOpt match {
          case None    => Future.successful(None)
          case Some(_) => panelRepo.updateAppearance(panelId, appearance, now)
        }
      }

    def applyConfig(panelOpt: Option[Panel]): Future[Option[Panel]] =
      spec.configPatch match {
        case None         => Future.successful(panelOpt)
        case Some(config) => panelOpt match {
          case None => Future.successful(None)
          case Some(existing) =>
            PanelConfigCodec.applyConfigPatch(existing, config) match {
              case Left(err)      => Future.failed(new IllegalArgumentException(err))
              case Right(updated) => panelRepo.replace(updated, now)
            }
        }
      }

    panelRepo.findById(panelId).flatMap {
      case None => Future.successful(None)
      case Some(existing) =>
        if (!spec.hasAnyField) Future.successful(Some(existing))
        else
          applyTitle(existing)
            .flatMap(applyAppearance)
            .flatMap(applyConfig)
            .flatMap {
              case None        => Future.successful(None)
              case Some(panel) => resolveBinding(panel).map(Some(_))
            }
    }
  }
}
