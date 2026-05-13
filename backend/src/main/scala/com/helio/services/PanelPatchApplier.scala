package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.PanelRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Applies a validated patch to a panel by composing per-field repository
 *  updates. Lives next to `PanelService` so the patch resolver and applier
 *  are colocated, but split into its own file to keep `PanelService.scala`
 *  inside the 300-line service budget.
 *
 *  Composition order matches the pre-CS2b `PanelRoutes` PATCH handler exactly:
 *  title → appearance → type → content → binding → image → divider →
 *  resolveTypeBinding. Each step short-circuits to `None` if the prior step
 *  returned `None`. */
private[services] final class PanelPatchApplier(panelRepo: PanelRepository)(implicit ec: ExecutionContext) {

  def apply(
      panelId: PanelId,
      spec: ResolvedPanelPatch,
      resolveBinding: Panel => Future[Panel]
  ): Future[Option[Panel]] = {
    val now           = Instant.now()
    val hasOtherField = spec.trimmedTitle.isDefined || spec.appearance.isDefined || spec.panelType.isDefined || spec.hasContent

    def applyType(panelOpt: Option[Panel]): Future[Option[Panel]] =
      spec.panelType match {
        case None     => Future.successful(panelOpt)
        case Some(pt) => panelOpt match {
          case None    => Future.successful(None)
          case Some(_) => panelRepo.updateType(panelId, pt, now)
        }
      }

    def applyContent(panelOpt: Option[Panel]): Future[Option[Panel]] =
      if (!spec.hasContent) Future.successful(panelOpt)
      else panelOpt match {
        case None    => Future.successful(None)
        case Some(_) => panelRepo.updateContent(panelId, spec.content, now)
      }

    def applyBinding(panelOpt: Option[Panel]): Future[Option[Panel]] = {
      val hasBinding = spec.typeIdUpdate.isDefined || spec.fieldMappingUpdate.isDefined
      if (!hasBinding) Future.successful(panelOpt)
      else panelOpt match {
        case None => Future.successful(None)
        case Some(panel) =>
          val newTypeId       = spec.typeIdUpdate.fold(panel.typeId)(identity)
          val newFieldMapping = spec.fieldMappingUpdate.fold(panel.fieldMapping)(identity)
          panelRepo.updateTypeBinding(panelId, newTypeId, newFieldMapping, now)
      }
    }

    def applyImage(panelOpt: Option[Panel]): Future[Option[Panel]] =
      if (!spec.hasImage) Future.successful(panelOpt)
      else panelOpt match {
        case None    => Future.successful(None)
        case Some(_) => panelRepo.updateImage(panelId, spec.imageUrl, spec.imageFit, now)
      }

    def applyDivider(panelOpt: Option[Panel]): Future[Option[Panel]] =
      if (!spec.hasDivider) Future.successful(panelOpt)
      else panelOpt match {
        case None    => Future.successful(None)
        case Some(_) => panelRepo.updateDividerFields(panelId, spec.dividerOrientation, spec.dividerWeight, spec.dividerColor, now)
      }

    val coreFuture: Future[Option[Panel]] =
      if (!hasOtherField) panelRepo.findById(panelId)
      else spec.trimmedTitle match {
        case Some(title) =>
          panelRepo.updateTitle(panelId, title, now).flatMap { result =>
            spec.appearance match {
              case None             => applyType(result).flatMap(applyContent)
              case Some(appearance) => result match {
                case None    => Future.successful(None)
                case Some(_) =>
                  panelRepo.updateAppearance(panelId, appearance, now)
                    .flatMap(applyType)
                    .flatMap(applyContent)
              }
            }
          }
        case None =>
          spec.appearance match {
            case Some(appearance) =>
              panelRepo.updateAppearance(panelId, appearance, now)
                .flatMap(applyType)
                .flatMap(applyContent)
            case None =>
              spec.panelType match {
                case Some(pt) => panelRepo.updateType(panelId, pt, now).flatMap(applyContent)
                case None     => panelRepo.updateContent(panelId, spec.content, now)
              }
          }
      }

    coreFuture
      .flatMap(applyBinding)
      .flatMap(applyImage)
      .flatMap(applyDivider)
      .flatMap {
        case None        => Future.successful(None)
        case Some(panel) => resolveBinding(panel).map(Some(_))
      }
  }
}
