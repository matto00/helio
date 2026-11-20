package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind}
import com.helio.services.sources.DataSourceService
import PatchSetApplyServiceJson._

import scala.concurrent.{ExecutionContext, Future}

/** Data-source-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetDataSourceResolvers {

  import PatchSetResolverSupport.{requireTargetId, decodeCreatePatch, prefixedWithEdit}

  /** `DataSourceService.update`'s order: the request-only blank-name rule ([[DataSourceService.validateUpdate]], read before the
   *  ownership lookup so nothing leaks) and patch presence, then ownership. HEL-1722 D4: both sides call the one function. */
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
        edit.dataSourcePatch match {
          case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a dataSource update")))
          case Some(request) =>
            DataSourceService.validateUpdate(request) match {
              case Left(err) => Future.successful(Left(prefixedWithEdit(index, err)))
              case Right(()) =>
                ctx.dataSourceRepo.findByIdOwned(sourceId, user).map {
                  case None => Left(ServiceError.NotFound(s"edit $index: Data source not found"))
                  case Some(existing) =>
                    Right(ResolvedEdit(
                      index, "dataSource", "update",
                      Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),
                      ResolvedAction.DataSourceUpdate(sourceId, request, existing)
                    ))
                }
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
        // HEL-1722 D4: `createStatic`'s own pre-insert checks (name, row cap, tag, column types, defaults, row validation), the same function
        // with the same cap constant (`DataSourceService.DatasetMaxRows`).
        Future.successful(DataSourceService.validateStatic(request, DataSourceService.DatasetMaxRows) match {
          case Left(err) => Left(prefixedWithEdit(index, err))
          case Right(_)  => Right(ResolvedEdit(index, "dataSource", "create", None, ResolvedAction.DataSourceCreate(request)))
        })
    }
}
