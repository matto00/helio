package com.helio.services.panels

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DatasetSource}
import com.helio.domain.panels.{FormPanelConfig, FormSchemaConsistency, PanelConfigCodec}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** The one set of binding checks a `form` panel's `dataSourceId` must pass: the source exists and
 *  is owned by the caller (never leaking existence: a foreign and a nonexistent id answer
 *  identically), is `dataset`-kind, and the form's fields fit the dataset's declared schema
 *  (HEL-1083/HEL-1084 design.md D1/D6). Extracted from `PanelService` (behavior-preserving, it
 *  delegates here) so the proposal wires (HEL-1148) run exactly the same checks as a direct panel
 *  create, never a weaker copy. A `null` repository (an unwired fixture, mirroring this codebase's
 *  other nullable-optional collaborators) skips every check. */
object FormBindingValidator {

  /** 404 when `dataSourceIdOpt` is provided but does not resolve to a real, owned data source. */
  def rejectMissingDataSource(
      dataSourceRepo: DataSourceRepository,
      dataSourceIdOpt: Option[DataSourceId],
      user: AuthenticatedUser
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    dataSourceIdOpt match {
      case None => Future.successful(Right(()))
      case Some(_) if dataSourceRepo == null => Future.successful(Right(()))
      case Some(dataSourceId) =>
        dataSourceRepo.findByIdOwned(dataSourceId, user).map {
          case Some(_) => Right(())
          case None    => Left(ServiceError.NotFound("Data source not found"))
        }
    }

  /** Schema-consistency check for a `form` panel's config (HEL-1084 design.md D1), evaluated on the
   *  EFFECTIVE config (the caller passes the post-patch config on update). `None` and a config with
   *  an empty `dataSourceId` skip the check (the missing-source check owns that case). Rule (a),
   *  the bound source must be `dataset`-kind, is checked here since it needs the resolved
   *  `DataSource`; (b)-(e) delegate to `FormSchemaConsistency.check`. */
  def rejectInconsistentForm(
      dataSourceRepo: DataSourceRepository,
      configOpt: Option[FormPanelConfig],
      user: AuthenticatedUser
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    configOpt.filter(_.dataSourceId.value.nonEmpty) match {
      case None => Future.successful(Right(()))
      case Some(_) if dataSourceRepo == null => Future.successful(Right(()))
      case Some(config) =>
        dataSourceRepo.findByIdOwned(config.dataSourceId, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Data source not found")))
          case Some(_: DatasetSource) =>
            dataSourceRepo.getDeclaredSchema(config.dataSourceId, user).map {
              case None => Left(ServiceError.NotFound("Data source not found"))
              case Some(declaration) =>
                FormSchemaConsistency.check(config, declaration) match {
                  case Left(msg) => Left(ServiceError.BadRequest(msg))
                  case Right(()) => Right(())
                }
            }
          case Some(ds) =>
            Future.successful(Left(ServiceError.BadRequest(s"form panels must be bound to a dataset source (this source is '${ds.kind}')")))
        }
    }

  /** Both checks, in the order `PanelService.create` runs them, for a `form` create-request whose
   *  config has already been given its `dataSourceId` (the proposal paths build it that way). An
   *  undecodable config is a 400 carrying the codec's own message. */
  def rejectForCreate(
      dataSourceRepo: DataSourceRepository,
      request: CreatePanelRequest,
      user: AuthenticatedUser
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    if (dataSourceRepo == null) Future.successful(Right(()))
    else
      PanelServiceHelpers.resolveCreateConfig(request) match {
        case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
        case Right(PanelConfigCodec.FormCreate(config)) =>
          rejectMissingDataSource(dataSourceRepo, Some(config.dataSourceId).filter(_.value.nonEmpty), user).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_)  => rejectInconsistentForm(dataSourceRepo, Some(config), user)
          }
        case Right(_) => Future.successful(Right(()))
      }
}
