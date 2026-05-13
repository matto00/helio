package com.helio.api.routes

import com.helio.api.{RequestValidation, UpdatePanelRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import spray.json.JsValue

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** A pre-validated, normalized snapshot of an `UpdatePanelRequest`.
 *
 *  `typeIdUpdate` and `fieldMappingUpdate` preserve the `Option[Option[_]]` wire
 *  semantics from the request:
 *    - outer `None`        — field absent (no change)
 *    - `Some(None)`        — explicit JSON `null` (clear binding)
 *    - `Some(Some(value))` — set to `value`
 *
 *  The custom Spray formatter in `PanelProtocol` produces this shape directly,
 *  so the apply chain threads it through unchanged. */
final case class ResolvedPanelPatch(
    trimmedTitle:       Option[String],
    appearance:         Option[PanelAppearance],
    panelType:          Option[PanelType],
    typeIdUpdate:       Option[Option[DataTypeId]],
    fieldMappingUpdate: Option[Option[JsValue]],
    content:            Option[String],
    hasContent:         Boolean,
    imageUrl:           Option[String],
    imageFit:           Option[String],
    hasImage:           Boolean,
    dividerOrientation: Option[String],
    dividerWeight:      Option[Int],
    dividerColor:       Option[String],
    hasDivider:         Boolean
)

/** Applies a validated patch to a panel by composing per-field repository updates.
 *
 *  Composition order matches the pre-refactor `PanelRoutes` PATCH handler exactly:
 *    title → appearance → type → content → binding → image → divider → resolveTypeBinding.
 *  Each step short-circuits to `None` if the prior step returned `None`. */
final class PanelPatchService(
    panelRepo:    PanelRepository,
    dataTypeRepo: DataTypeRepository,
    user:         AuthenticatedUser
)(implicit ec: ExecutionContext) {

  /** Resolve a panel's typeId against the authenticated user's owned types.
   *  If the panel's typeId references a type owned by a different user, the
   *  typeId and fieldMapping are cleared (treated as unbound). */
  private def resolveTypeBinding(panel: Panel): Future[Panel] =
    panel.typeId match {
      case None => Future.successful(panel)
      case Some(typeId) =>
        dataTypeRepo.findById(typeId, user.id).map {
          case None    => panel.copy(typeId = None, fieldMapping = None)
          case Some(_) => panel
        }
    }

  def applyPanelPatch(panelId: PanelId, spec: ResolvedPanelPatch): Future[Option[Panel]] = {
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
        case Some(panel) => resolveTypeBinding(panel).map(Some(_))
      }
  }

  /** Validate + normalize an `UpdatePanelRequest`. Replaces the previous 8-level
   *  nested branching with a single `for`-comprehension over `Either`. The
   *  `Option[Option[_]]` wire semantics for `typeId` and `fieldMapping` are preserved
   *  by `ResolvedPanelPatch`. */
  def resolvePatch(request: UpdatePanelRequest): Either[String, ResolvedPanelPatch] = {
    val trimmedTitle  = request.title.map(_.trim)
    val hasBinding    = request.typeId.isDefined || request.fieldMapping.isDefined
    val hasContent    = request.content.isDefined
    val hasImage      = request.imageUrl.isDefined || request.imageFit.isDefined
    val hasDivider    = request.dividerOrientation.isDefined || request.dividerWeight.isDefined || request.dividerColor.isDefined
    val hasOtherField = trimmedTitle.isDefined || request.appearance.isDefined || request.`type`.isDefined || hasContent

    for {
      _            <- if (trimmedTitle.contains("")) Left("title must not be blank") else Right(())
      _            <- if (hasOtherField || hasBinding || hasImage || hasDivider) Right(())
                      else Left("at least one field is required")
      _            <- RequestValidation.validateImageFit(request.imageFit)
      _            <- RequestValidation.validateDividerOrientation(request.dividerOrientation)
      panelTypeOpt <- validatePanelTypeOpt(request.`type`)
    } yield ResolvedPanelPatch(
      trimmedTitle       = trimmedTitle,
      appearance         = request.appearance.map(p =>
                             PanelAppearance(
                               background   = RequestValidation.normalizePanelBackground(p.background),
                               color        = RequestValidation.normalizePanelColor(p.color),
                               transparency = RequestValidation.normalizeTransparency(p.transparency),
                               chart        = p.chart
                             )
                           ),
      panelType          = panelTypeOpt,
      typeIdUpdate       = request.typeId.map(_.map(DataTypeId(_))),
      fieldMappingUpdate = request.fieldMapping,
      content            = request.content,
      hasContent         = hasContent,
      imageUrl           = request.imageUrl,
      imageFit           = request.imageFit,
      hasImage           = hasImage,
      dividerOrientation = request.dividerOrientation,
      dividerWeight      = request.dividerWeight,
      dividerColor       = request.dividerColor,
      hasDivider         = hasDivider
    )
  }

  private def validatePanelTypeOpt(typeOpt: Option[String]): Either[String, Option[PanelType]] =
    typeOpt match {
      case None    => Right(None)
      case Some(t) => PanelType.fromString(t).map(Some(_))
    }
}
