package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind}
import PatchSetApplyServiceJson._

import scala.concurrent.{ExecutionContext, Future}

/** Data-source-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetDataSourceResolvers {

  import PatchSetResolverSupport.{requireTargetId, decodeCreatePatch}

  private[patchsets] def resolveDataSourceUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val sourceId = DataSourceId(idStr)
        ctx.dataSourceRepo.findByIdOwned(sourceId, user).map {
          case None => Left(ServiceError.NotFound(s"edit $index: data source not found"))
          case Some(existing) =>
            edit.dataSourcePatch match {
              case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a dataSource update"))
              case Some(request) =>
                Right(ResolvedEdit(
                  index, "dataSource", "update",
                  Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),
                  ResolvedAction.DataSourceUpdate(sourceId, request, existing)
                ))
            }
        }
    }

  private[patchsets] def resolveDataSourceDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val sourceId = DataSourceId(idStr)
        ctx.dataSourceRepo.findByIdOwned(sourceId, user).map {
          case None => Left(ServiceError.NotFound(s"edit $index: data source not found"))
          case Some(existing) =>
            Right(ResolvedEdit(
              index, "dataSource", "delete",
              Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),
              ResolvedAction.DataSourceDelete(sourceId, existing)
            ))
        }
    }

  private[patchsets] def resolveDataSourceCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[StaticDataSourceRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) if DataSourceKind.canonicalize(request.`type`) != DataSourceKind.Dataset =>
        // design.md D1: only `dataset` (alias `static`) is supported (pure JSON, no I/O) —
        // the other nine create variants need file bytes or live I/O.
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: dataSource create only supports type '${DataSourceKind.Dataset}'")))
      case Right(request) =>
        Future.successful(Right(ResolvedEdit(index, "dataSource", "create", None, ResolvedAction.DataSourceCreate(request))))
    }
}
