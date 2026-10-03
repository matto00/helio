package com.helio.services.panels

import com.helio.api.protocols.panels.PanelBatchItem
import com.helio.domain.model.{AuthenticatedUser, Panel}
import com.helio.domain.panels.{OutputPanel, PanelConfigCodec}
import com.helio.services.ServiceError

import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1203: the batch-PATCH counterpart of `PanelService.update`'s config checks. `batchUpdate`
 *  writes through `PanelMutationRepository`, whose failures collapse into a generic "Batch update
 *  failed", so every item's config patch is decoded and its controls validated here, BEFORE the
 *  transactional write, with the same messages the single PATCH returns (prefixed by the panel id
 *  so a caller can tell which item failed). Zero DB writes. */
private[services] final class BatchControlsCheck(validator: OutputControlsValidator)(implicit ec: ExecutionContext) {

  def apply(pairs: Vector[(PanelBatchItem, Panel)], user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pairs.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      case (accF, (item, existing)) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => item.config.fold[Future[Either[ServiceError, Unit]]](Future.successful(Right(())))(check(item, existing, _, user))
        }
    }

  private def check(
      item: PanelBatchItem,
      existing: Panel,
      config: JsValue,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    PanelConfigCodec.applyConfigPatch(existing, config) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(s"panel '${item.id}': $err")))
      case Right(patched: OutputPanel) =>
        val existingControls = existing match {
          case op: OutputPanel => op.config.controls
          case _               => Vector.empty
        }
        validator.reject(patched.outputId, patched.config.controls, existingControls, user).map {
          case Left(ServiceError.BadRequest(msg)) => Left(ServiceError.BadRequest(s"panel '${item.id}': $msg"))
          case other                              => other
        }
      case Right(_) => Future.successful(Right(()))
    }
}
