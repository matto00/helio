package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId}
import PatchSetApplyServiceJson._
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** Output-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetOutputResolvers {

  import PatchSetResolverSupport.requireTargetId

  // ── output (HEL-907 task 1.2 — no create, see PatchSetProtocol's doc) ────

  /** Owner-only, mirroring `OutputService.update`/`delete`'s own check exactly (`findById` is
   *  sharing-aware RLS -- any pipeline grantee can READ -- but only the owner may mutate; a
   *  non-owner sees 404, existence not leaked, never 403). */
  private def findOwnedOutput(
      id: OutputId,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Output]] =
    ctx.outputRepo.findById(id, user).map {
      case None                                     => Left(ServiceError.NotFound("Output not found"))
      case Some(output) if output.ownerId != user.id => Left(ServiceError.NotFound("Output not found"))
      case Some(output)                              => Right(output)
    }

  private[patchsets] def resolveOutputUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val outputId = OutputId(idStr)
        findOwnedOutput(outputId, user, ctx).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(existing) =>
            ctx.outputRepo.findConfigById(outputId, user).map {
              case None => Left(ServiceError.NotFound(s"edit $index: output not found"))
              case Some(existingConfig) =>
                edit.outputPatch match {
                  case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for an output update"))
                  case Some(request) =>
                    Right(ResolvedEdit(
                      index, "output", "update",
                      Some(outputResponseFormat.write(outputResponseFrom(existing, existingConfig))),
                      ResolvedAction.OutputUpdate(outputId, request, existing, existingConfig)
                    ))
                }
            }
        }
    }

  private[patchsets] def resolveOutputDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val outputId = OutputId(idStr)
        findOwnedOutput(outputId, user, ctx).map {
          case Left(err) => Left(err)
          case Right(existing) =>
            Right(ResolvedEdit(
              index, "output", "delete",
              // HEL-946: config is deliberately omitted here, not defaulted by
              // a silent overload — this resolved-state snapshot is for a
              // delete, so the Output's config is about to cease to exist and
              // isn't needed by any consumer of this outcome.
              Some(outputResponseFormat.write(outputResponseFrom(existing, JsObject.empty))),
              ResolvedAction.OutputDelete(outputId, existing)
            ))
        }
    }
}
