package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateConnectorRequest, UpdateConnectorRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.{ConnectorHasDependents, ConnectorRepository}
import com.helio.services.ServiceError
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/connectors` (HEL-821). Thin, mirrors
 *  `AlertRuleService`'s shape -- validation + ACL dispatch, everything else
 *  in [[ConnectorRepository]]. Never calls
 *  `ConnectorCredentialRepository.decryptForUse` -- that path is reached
 *  only by the AC5 outbound-auth integration test (design.md Decision 6a). */
final class ConnectorEntityService(
    connectorRepo: ConnectorRepository,
    dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0)
)(implicit ec: ExecutionContext) {

  def findAll(user: AuthenticatedUser): Future[Vector[Connector]] =
    connectorRepo.findAll(user)

  def findById(id: ConnectorId, user: AuthenticatedUser): Future[Either[ServiceError, Connector]] =
    connectorRepo.findByIdOwned(id, user).map {
      case Some(c) => Right(c)
      case None    => Left(ServiceError.NotFound("Connector not found"))
    }

  def create(req: CreateConnectorRequest, user: AuthenticatedUser): Future[Either[ServiceError, Connector]] = {
    val name    = req.name.trim
    val kind    = req.kind.trim
    val baseUrl = req.baseUrl.trim
    val cred    = req.credential

    if (name.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (baseUrl.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("baseUrl is required")))
    else if (cred.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("credential is required")))
    else
      DataSourceKind.parseKind(kind) match {
        case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
        case Right(validKind) =>
          val configJson = req.config.getOrElse(JsObject.empty).compactPrint
          connectorRepo
            .create(
              ownerId             = user.id,
              name                = name,
              kind                = validKind,
              baseUrl             = baseUrl,
              config              = configJson,
              credentialPlaintext = cred,
              credentialName      = s"$name (Connector credential)"
            )
            .map(Right(_))
      }
  }

  def update(id: ConnectorId, req: UpdateConnectorRequest, user: AuthenticatedUser): Future[Either[ServiceError, Connector]] =
    connectorRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Connector not found")))
      case Some(existing) =>
        val name    = req.name.map(_.trim).getOrElse(existing.name)
        val baseUrl = req.baseUrl.map(_.trim).getOrElse(existing.baseUrl)
        val config  = req.config.map(_.compactPrint).getOrElse(existing.config)
        if (name.isEmpty)
          Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
        else if (baseUrl.isEmpty)
          Future.successful(Left(ServiceError.BadRequest("baseUrl must not be empty")))
        else
          connectorRepo.update(id, name, baseUrl, config, Instant.now(), user).map {
            case Some(updated) => Right(updated)
            case None          => Left(ServiceError.NotFound("Connector not found"))
          }
    }

  def delete(id: ConnectorId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    connectorRepo.delete(id, user, dependentCount).map {
      case Left(ConnectorHasDependents) =>
        Left(ServiceError.Conflict("ConnectorHasDependents: this Connector is still referenced by a dependent resource"))
      case Right(false) => Left(ServiceError.NotFound("Connector not found"))
      case Right(true)  => Right(())
    }
}
