package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.UpdatePanelRequest
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.services.panels.PanelServiceHelpers._

import scala.concurrent.{ExecutionContext, Future}

/** `PanelService.update`'s post-authorize validation chain (decode -> binding existence -> controls ->
 *  form consistency), split out of `PanelService`. Ends where `PanelPatchApplier.apply` begins; a throw
 *  anywhere in the chain stays a failed Future (the caller's `IllegalArgumentException` recover wraps
 *  only the apply). */
private[panels] final class PanelUpdateValidation(
    bindingChecks:           PanelBindingChecks,
    outputControlsValidator: OutputControlsValidator
)(implicit ec: ExecutionContext) {

  import bindingChecks._
  import PanelBindingChecks._

  def validate(
      existing: Panel,
      request: UpdatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, ResolvedPanelPatch]] =
    // HEL-1203: the config patch is decoded + structurally validated here, AFTER the
    // 404/403 lookups in PanelService.update (an absent/foreign panel never reaches this, so nothing about
    // its existence leaks) and BEFORE any further read or write — a malformed/duplicate/
    // misplaced `controls` is a 400, not the 500 a bare decode exception used to become.
    resolvePatch(request, existing).flatMap(spec => patchedConfigOf(existing, spec).map(spec -> _)) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
      case Right((spec, patchedPanel)) =>
        val incomingOutputId     = spec.configPatch.flatMap(outputIdFromConfigPatch)
        val incomingDataSourceId = spec.configPatch.flatMap(dataSourceIdFromConfigPatch)
        rejectMissingOutput(incomingOutputId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => rejectMissingDataSource(incomingDataSourceId, user)
        }.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  =>
            // HEL-1189 design.md D4: validated against the EFFECTIVE post-patch config (C2
            // convention, mirroring rejectInconsistentForm below) — a `controls`-only PATCH
            // (or an outputId-only one) is diffed correctly either way, and a PATCH that
            // omits `config`/`controls` entirely carries the unchanged persisted list
            // through untouched (nothing to validate, per D4's "an update omitting
            // controls is unaffected" rule).
            val effectiveOutput = patchedPanel.collect { case op: OutputPanel => op.config }
            val existingControls = existing match {
              case op: OutputPanel => op.config.controls
              case _               => Vector.empty
            }
            outputControlsValidator.reject(
              effectiveOutput.map(_.outputId).filter(_.value.nonEmpty),
              effectiveOutput.map(_.controls).getOrElse(Vector.empty),
              existingControls,
              user
            )
        }.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => rejectInconsistentForm(effectiveFormConfig(existing, spec), user)
        }.map {
          case Left(err) => Left(err)
          case Right(_)  => Right(spec)
        }
    }
}
