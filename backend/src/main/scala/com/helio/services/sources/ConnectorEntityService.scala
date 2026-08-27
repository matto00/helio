package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateConnectorRequest, UpdateConnectorRequest}
import com.helio.domain.connectors.ConnectorAuthShape
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
    val name       = req.name.trim
    val kind       = req.kind.trim
    val baseUrl    = req.baseUrl.trim
    val cred       = req.credential
    val configJObj = req.config.getOrElse(JsObject.empty).asJsObject
    // HEL-822 design.md Decision 6 revised (CR6): a no-auth Connector (authType = "none") is
    // allowed an explicitly-empty credential -- bearer/api_key still require a non-empty one.
    val authType = configJObj.fields.get("authType").collect { case JsString(t) => t }.getOrElse("")

    if (name.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (baseUrl.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("baseUrl is required")))
    else if (cred.isEmpty && authType != "none")
      Future.successful(Left(ServiceError.BadRequest("credential is required")))
    else
      DataSourceKind.parseKind(kind) match {
        case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
        case Right(validKind) =>
          // HEL-822 design.md Decision 1a revised (CR5): `implicit` is server-owned -- strip
          // any client-supplied value and set it explicitly (false: this is a direct,
          // user-initiated POST /api/connectors call, never the synthesis helper's own path).
          val configJson = withServerOwnedImplicit(configJObj, implicitFlag = false)
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
        // HEL-822 design.md Decision 1a revised (CR5): `implicit` is server-owned -- a PATCH
        // can never flip it, regardless of what the client's config body carries. Preserve the
        // EXISTING row's `implicit` value (parsed from its own stored config), not a hardcoded
        // `false` -- a synthesized implicit Connector must stay `implicit: true` across updates.
        val existingImplicit = ConnectorAuthShape.parse(existing.config).`implicit`
        val config = req.config
          .map(c => withServerOwnedImplicit(c.asJsObject, existingImplicit))
          .getOrElse(existing.config)
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

  /** Strips any client-supplied `implicit` key from `config` and sets the server-owned value
   *  explicitly (design.md Decision 1a revised, CR5) -- the ONE place both `create`/`update`
   *  funnel through, so the two call sites can never drift on how this is enforced. */
  private def withServerOwnedImplicit(config: JsObject, implicitFlag: Boolean): String =
    JsObject(config.fields - "implicit" + ("implicit" -> JsBoolean(implicitFlag))).compactPrint
}
