package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateConnectorRequest, UpdateConnectorRequest}
import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.{ConnectorHasDependents, ConnectorRepository, ConnectorRotationNotFound}
import com.helio.services.ServiceError
import spray.json._

import java.net.InetAddress
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Business logic for `/api/connectors` (HEL-821). Thin, mirrors
 *  `AlertRuleService`'s shape -- validation + ACL dispatch, everything else
 *  in [[ConnectorRepository]]. Never calls
 *  `ConnectorCredentialRepository.decryptForUse` -- that path is reached
 *  only by the AC5 outbound-auth integration test (design.md Decision 6a). */
final class ConnectorEntityService(
    connectorRepo: ConnectorRepository,
    dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0),
    // HEL-879 design.md Decision 4/5: same injected seam as
    // `RestApiConnectorDriver`, wired separately -- this class is
    // constructed in `ApiRoutes` (unlike the driver), so its real defaults
    // are wired there alongside the existing `dataSourceUrl*` params.
    // Non-authoritative (Decision 4): a host resolving publicly at
    // create/update time can resolve internally later, so this only stops a
    // hostile value at write time -- the fetch-time guard in the driver is
    // what's actually authoritative.
    resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
)(implicit ec: ExecutionContext) {

  /** Returns `(Connector, dependentCount)` pairs -- HEL-824 design.md Decision 1b. Deliberately
   *  returns domain/primitive types only, never `ConnectorMeta`/the protocol layer (skeptic
   *  design-round-2 non-blocking note 1); `ConnectorEntityRoutes` maps each pair to
   *  `ConnectorMeta.fromDomain` at its own call sites. */
  def findAll(user: AuthenticatedUser): Future[Vector[(Connector, Int)]] =
    connectorRepo.findAll(user).flatMap { connectors =>
      Future.sequence(connectors.map(c => dependentCount(c.id).map(n => (c, n))))
    }

  def findById(id: ConnectorId, user: AuthenticatedUser): Future[Either[ServiceError, (Connector, Int)]] =
    connectorRepo.findByIdOwned(id, user).flatMap {
      case Some(c) => dependentCount(c.id).map(n => Right((c, n)))
      case None    => Future.successful(Left(ServiceError.NotFound("Connector not found")))
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
      // HEL-879 design.md Decision 4: egress-validate baseUrl AFTER the
      // non-empty check, BEFORE anything is persisted -- a refusal here
      // creates no row. HEL-879 cycle-3 fix: a merely-unresolvable host is
      // NOT refused here (see checkCreateTimeEgress) -- only a disallowed
      // address or a structurally bad URL/scheme is.
      checkCreateTimeEgress(baseUrl) match {
        case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
        case Right(()) =>
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
  }

  /** `PATCH`'s dependent count is resolved for real (not the `create` 0-default) -- a rename
   *  doesn't change dependents, but the row already had whatever count it had (task 1.2 note 2). */
  def update(id: ConnectorId, req: UpdateConnectorRequest, user: AuthenticatedUser): Future[Either[ServiceError, (Connector, Int)]] =
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
          // HEL-879 design.md Decision 4: same egress validation as create --
          // a refusal leaves the stored row unchanged. Same unresolvable-is-OK
          // relaxation as create (HEL-879 cycle-3 fix).
          checkCreateTimeEgress(baseUrl) match {
            case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
            case Right(()) =>
              connectorRepo.update(id, name, baseUrl, config, Instant.now(), user).flatMap {
                case Some(updated) => dependentCount(id).map(n => Right((updated, n)))
                case None          => Future.successful(Left(ServiceError.NotFound("Connector not found")))
              }
          }
    }

  /** Credential rotation (HEL-824 design.md Decision 1) -- stays thin, matching every other
   *  method in this class: validates the new value is non-empty, delegates straight to
   *  `connectorRepo.rotateCredential`, maps the result to `ServiceError`. No new
   *  `ConnectorCredentialRepository` dependency is added here -- `ConnectorRepository` already
   *  has one. */
  def rotateCredential(
      id: ConnectorId,
      newCredentialPlaintext: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Connector, Int)]] =
    if (newCredentialPlaintext.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("credential is required")))
    else
      connectorRepo
        .rotateCredential(
          id                     = id,
          newCredentialPlaintext = newCredentialPlaintext,
          credentialName         = "Connector credential (rotated)",
          user                   = user
        )
        .flatMap {
          case Right(connector)                => dependentCount(id).map(n => Right((connector, n)))
          case Left(ConnectorRotationNotFound) => Future.successful(Left(ServiceError.NotFound("Connector not found")))
        }

  def delete(id: ConnectorId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    connectorRepo.delete(id, user, dependentCount).map {
      case Left(ConnectorHasDependents) =>
        Left(ServiceError.Conflict("ConnectorHasDependents: this Connector is still referenced by a dependent resource"))
      case Right(false) => Left(ServiceError.NotFound("Connector not found"))
      case Right(true)  => Right(())
    }

  /** HEL-879 cycle-3 fix: create/update-time egress check, deliberately LESS strict than
   *  fetch-time (`RestApiConnectorDriver`'s guarded issuers, which still fail closed on an
   *  unresolvable host -- untouched by this method). Neither `specs/connectors/connector-
   *  management/spec.md` nor ticket AC1 requires refusing a host that simply does not resolve
   *  right now -- only one resolving to loopback/link-local/private address space. Refusing an
   *  unresolvable host at write time made Connector creation depend on live DNS for a
   *  not-yet-provisioned internal host or a flaky resolver, which is not a security property
   *  this ticket asked for. `EgressCheck.Unresolvable` is therefore treated as acceptable here;
   *  `EgressCheck.Disallowed` (resolves to a disallowed address) and `EgressCheck.Invalid` (bad
   *  scheme / missing host / unparseable URL) are still refused, exactly as before. The
   *  authoritative guard remains the fetch-time one -- see design.md Decision 4: this write-time
   *  check was already documented as non-authoritative. */
  private def checkCreateTimeEgress(baseUrl: String): Either[String, Unit] =
    ContentSourceSupport.checkEgress(baseUrl, resolveHost, isBlocked) match {
      case EgressCheck.Allowed(_)      => Right(())
      case EgressCheck.Unresolvable(_) => Right(())
      case EgressCheck.Invalid(msg)    => Left(msg)
      case EgressCheck.Disallowed(msg) => Left(msg)
    }

  /** Strips any client-supplied `implicit` key from `config` and sets the server-owned value
   *  explicitly (design.md Decision 1a revised, CR5) -- the ONE place both `create`/`update`
   *  funnel through, so the two call sites can never drift on how this is enforced. */
  private def withServerOwnedImplicit(config: JsObject, implicitFlag: Boolean): String =
    JsObject(config.fields - "implicit" + ("implicit" -> JsBoolean(implicitFlag))).compactPrint
}
