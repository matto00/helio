package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** The binding-existence and form-consistency checks shared by `PanelService`'s create/update paths,
 *  plus the default placement size, split out of `PanelService`. `dataSourceRepo` is nullable-optional
 *  exactly as on `PanelService`. */
private[panels] final class PanelBindingChecks(
    outputRepo:     OutputRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  /** The size a new `panel` takes in each breakpoint. An Output panel takes its Output kind's
   *  decision-15 default (`OutputPanelDefaultSize`), scaled per breakpoint's column count; every other
   *  kind, and an Output whose output cannot be resolved (placement is never skipped), takes
   *  [[PlacementSizes.ContentDefault]]. */
  def defaultSizesFor(panel: Panel): Future[PlacementSizes] =
    panel match {
      case outputPanel: OutputPanel =>
        outputPanel.outputId match {
          case None => Future.successful(PlacementSizes.ContentDefault)
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).map {
              case None         => PlacementSizes.ContentDefault
              case Some(output) =>
                val size = OutputPanelDefaultSize.forKind(output.kind)
                PlacementSizes.scaledFromLg(ItemSize(size.w, size.h))
            }
        }
      case _ => Future.successful(PlacementSizes.ContentDefault)
    }

  // HEL-904 task 4.1: `rejectCompanionBinding` (enforce-pipeline-only-bindings,
  // V41) removed outright — Text/Markdown's data-bound "Source mode" no
  // longer exists, so no panel-create/patch path can carry a `dataTypeId`
  // binding to reject in the first place.

  /** 404 when `outputIdOpt` is provided but does not resolve to a real,
   *  owned Output. HEL-904 follow-up (flagged cycle 17): closes the gap where
   *  an `"output"`-kind panel's `outputId` reached `panelRepo.insert`/
   *  `patchApplier.apply` unchecked and hit the raw `panels.output_id` FK
   *  violation as a 500 instead of a clean, explicit rejection. A `None`
   *  input (no outputId in this create/patch) passes through unchanged. */
  def rejectMissingOutput(
      outputIdOpt: Option[OutputId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    outputIdOpt match {
      case None => Future.successful(Right(()))
      case Some(outputId) =>
        outputRepo.findByIdOwned(outputId, user).map {
          case Some(_) => Right(())
          case None    => Left(ServiceError.NotFound("Output not found"))
        }
    }

  /** 404 when `dataSourceIdOpt` is provided but does not resolve to a real, owned data source
   *  (design.md D6) — delegates to the shared [[FormBindingValidator]] the proposal paths also use. */
  def rejectMissingDataSource(
      dataSourceIdOpt: Option[DataSourceId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    FormBindingValidator.rejectMissingDataSource(dataSourceRepo, dataSourceIdOpt, user)

  /** HEL-1084 design.md D1: schema-consistency check for a `form` panel's EFFECTIVE (post-patch on
   *  `update`) config — delegates to the shared [[FormBindingValidator]] so the proposal paths
   *  (HEL-1148) run the identical checks. */
  def rejectInconsistentForm(
      configOpt: Option[FormPanelConfig],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    FormBindingValidator.rejectInconsistentForm(dataSourceRepo, configOpt, user)

  // HEL-904 task 3.9/4.1: `rejectUnresolvableMetric` (HEL-500) and
  // `metricRepo` (the constructor's legacy unused parameter) both removed —
  // metrics no longer exist.
}

/** The pure panel/spec extractors the checks above are fed with. */
private[panels] object PanelBindingChecks {

  /** Extracts an `output` panel's `outputId`/`controls`, `None`/empty for every other kind. Feeds
   *  `outputControlsValidator.reject` with the newly-built panel on `create`. */
  def outputIdOf(panel: Panel): Option[OutputId] = panel match {
    case p: OutputPanel => p.outputId
    case _              => None
  }

  def controlsOf(panel: Panel): Vector[OutputControlSpec] = panel match {
    case p: OutputPanel => p.config.controls
    case _              => Vector.empty
  }

  /** The post-patch panel for `update` (C2, mirrors `effectiveFormConfig`): the stored panel with
   *  the decoded config patch applied — never the incoming patch alone, so a `controls`-only PATCH
   *  still carries the CURRENT `outputId` through (and vice versa). `None` when the request carries
   *  no `config` (nothing config-related changes). `Left` is the codec's curated 400 message. */
  def patchedConfigOf(existing: Panel, spec: ResolvedPanelPatch): Either[String, Option[Panel]] =
    spec.configPatch match {
      case None         => Right(None)
      case Some(config) => PanelConfigCodec.applyConfigPatch(existing, config).map(Some(_))
    }

  /** Extracts a `form` panel's config from a domain `Panel`, `None` for every other kind. Feeds
   *  `rejectInconsistentForm` with the effective (post-patch, on `update`) config. */
  def formConfigOf(panel: Panel): Option[FormPanelConfig] = panel match {
    case p: FormPanel => Some(p.config)
    case _            => None
  }

  /** The EFFECTIVE post-patch form config for `update` (C2): `existing` as a `FormPanel`,
   *  `applyPatch`ed with the decoded form patch — never the incoming patch alone, so a
   *  `dataSourceId`-only PATCH re-validates the existing fields against the new dataset. `None`
   *  when `existing` is not a `form` panel, or the patch carries no `configPatch` at all (nothing
   *  form-related changed, nothing to re-check). */
  def effectiveFormConfig(existing: Panel, spec: ResolvedPanelPatch): Option[FormPanelConfig] =
    (existing, spec.configPatch) match {
      case (form: FormPanel, Some(patchJson)) =>
        Some(form.applyPatch(FormPanelConfig.Patch.decode(patchJson)).config)
      case _ => None
    }
}
