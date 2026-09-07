package com.helio.services.sources

import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model._
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.sources.{ConnectorCompletionTokenRepository, ConnectorRepository}
import com.helio.services.ServiceError

import java.security.SecureRandom
import java.time.{Duration, Instant}
import java.util.Base64
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-955 design.md D1-D10: business logic for the pending-connector handoff -- minting a
 *  pending Connector + completion token (agent-facing, via `create_connector`), the owner
 *  re-mint endpoint, and the anonymous completion submission. Mirrors `ShareTokenService`'s
 *  overall shape (token generation, hashing, expiry) but is single-use/atomic-supersede rather
 *  than revocable (D3/D9). */
final class ConnectorCompletionService(
    connectorRepo: ConnectorRepository,
    tokenRepo:     ConnectorCompletionTokenRepository,
    // HEL-955 design.md D9: 60-minute default, operator-configurable in either direction,
    // hard-capped at a 24-hour ceiling -- `min(configured, 24h)`, so the ceiling is reachable
    // and is the worst case the Risks statement is argued against.
    defaultExpiry: Duration = Duration.ofMinutes(60),
    maxExpiry:     Duration = Duration.ofHours(24)
)(implicit ec: ExecutionContext) {

  import ConnectorCompletionService._

  private val effectiveExpiry: Duration =
    if (defaultExpiry.compareTo(maxExpiry) > 0) maxExpiry else defaultExpiry

  /** `create_connector` against a credentialed host (design.md D9/task 4.6): re-mints on an
   *  existing pending row matching **owner + kind + normalized base URL + intended auth shape**
   *  rather than duplicating; a differing auth shape forks a separate pending Connector. On
   *  multiple matches the most recently created wins (repo already sorts by `createdAt.desc`). */
  def createOrRemintPending(
      name: String,
      kind: String,
      baseUrl: String,
      authShape: ConnectorAuthShape,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, MintedToken]] = {
    val trimmedName    = name.trim
    val trimmedBaseUrl = baseUrl.trim
    if (trimmedName.isEmpty) Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (trimmedBaseUrl.isEmpty) Future.successful(Left(ServiceError.BadRequest("baseUrl is required")))
    else
      DataSourceKind.parseKind(kind.trim) match {
        case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
        case Right(validKind) =>
          val normalizedTarget = ConnectorCompletionNormalization.normalizeBaseUrl(trimmedBaseUrl)
          connectorRepo.findPendingByOwnerAndKind(user.id, validKind).flatMap { candidates =>
            val matched = candidates.find { c =>
              ConnectorCompletionNormalization.normalizeBaseUrl(c.baseUrl) == normalizedTarget &&
                ConnectorAuthShape.parse(c.config) == authShape.copy(`implicit` = false)
            }
            matched match {
              case Some(existing) => mintToken(existing.id, user).map(t => Right(t))
              case None =>
                val configJson = ConnectorAuthShape.encode(authShape.copy(`implicit` = false))
                connectorRepo.createPending(user.id, trimmedName, validKind, trimmedBaseUrl, configJson).flatMap { created =>
                  mintToken(created.id, user).map(t => Right(t))
                }
            }
          }
      }
  }

  /** `POST /api/connectors/:id/completion-token` (design.md D9): authenticated, owner-scoped
   *  re-mint. Standard not-found mapping for non-owner or non-existent; distinct "already
   *  completed" for an owner's own already-complete Connector (design.md D10). */
  def ownerRemint(connectorId: ConnectorId, user: AuthenticatedUser): Future[Either[ServiceError, MintedToken]] =
    connectorRepo.findByIdOwned(connectorId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Connector not found")))
      case Some(c) if !c.isPending =>
        Future.successful(Left(ServiceError.Conflict("This Connector has already been completed")))
      case Some(c) => mintToken(c.id, user).map(Right(_))
    }

  private def mintToken(connectorId: ConnectorId, user: AuthenticatedUser): Future[MintedToken] = {
    val raw       = generateRawToken()
    val hash      = TokenHashing.sha256Hex(raw)
    val expiresAt = Instant.now().plus(effectiveExpiry)
    tokenRepo.mintSupersedingPrior(connectorId, user.id, hash, expiresAt).map { _ =>
      MintedToken(connectorId, raw, expiresAt)
    }
  }

  /** Resolves a raw token to its pending Connector, applying the SAME validity/ownership checks
   *  `complete` applies (found, live, still pending, owner-matches-if-authenticated) -- shared so
   *  the two can never drift on what counts as "usable". Never consumes the token and never
   *  mutates anything; read-only. */
  private def resolveValidToken(rawToken: String, requestingUser: Option[AuthenticatedUser]): Future[Either[ServiceError, Connector]] =
    if (rawToken.trim.isEmpty) Future.successful(Left(RefusalError))
    else {
      val hash = TokenHashing.sha256Hex(rawToken)
      tokenRepo.findByHash(hash).flatMap {
        case None => Future.successful(Left(RefusalError))
        case Some(token) if !token.isValid(Instant.now()) => Future.successful(Left(RefusalError))
        case Some(token) =>
          connectorRepo.findByIdUnscoped(token.connectorId).map {
            case None => Left(RefusalError)
            case Some(connector) if !connector.isPending => Left(RefusalError)
            case Some(connector) if requestingUser.exists(_.id != connector.ownerId) => Left(RefusalError)
            case Some(connector) => Right(connector)
          }
      }
    }

  /** HEL-955 evaluation-1.md CR4: `GET`-shaped lookup backing the completion page's form --
   *  returns the pending Connector's INTENDED auth shape (design.md D9: "the pending row
   *  persists its intended auth shape and the completion page renders from it") so the page
   *  never asks the human to guess-and-discard an auth-type selection. Disclosing the shape to
   *  whoever already holds a valid token adds no capability beyond what `complete` already grants
   *  that same holder (bind an arbitrary credential) -- it is not a new oracle, since every
   *  failure mode still collapses to the same [[RefusalError]]. Never returns the credential
   *  itself (there isn't one yet) and never a field this Connector doesn't already expose via
   *  `ConnectorMeta.config` to its owner. */
  def describePending(rawToken: String, requestingUser: Option[AuthenticatedUser]): Future[Either[ServiceError, ConnectorAuthShape]] =
    resolveValidToken(rawToken, requestingUser).map(_.map(c => ConnectorAuthShape.parse(c.config)))

  /** Anonymous completion submission (design.md D5): every failure mode -- unknown/expired/
   *  consumed/superseded token, empty credential, encryption failure, an authenticated
   *  non-owner -- returns the SAME curated refusal, so the endpoint is not an existence oracle.
   *  `requestingUser` is `None` for an unauthenticated caller (the ticket's whole purpose); when
   *  present, that user MUST be the Connector's owner.
   *
   *  Ordering (design.md D3/task 4.3): the credential is encrypted BEFORE the token is
   *  consumed, so an encryption failure never consumes the token; the token is consumed via
   *  [[ConnectorCompletionTokenRepository.consume]]'s atomic conditional predicate BEFORE the
   *  Connector is repointed, so a token superseded by a concurrent re-mint (D9) cannot bind even
   *  if it was read as live moments earlier. A repoint that fails after a successful consume
   *  (Connector vanished/completed concurrently) compensates by deleting the just-minted
   *  credential row. */
  def complete(rawToken: String, credential: String, requestingUser: Option[AuthenticatedUser]): Future[Either[ServiceError, Unit]] =
    if (credential.trim.isEmpty)
      Future.successful(Left(RefusalError))
    else
      resolveValidToken(rawToken, requestingUser).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(connector) =>
          val hash        = TokenHashing.sha256Hex(rawToken)
          val completedBy = requestingUser.map(_.id.value).getOrElse(AnonymousCompletedBy)
          connectorRepo.encryptCredential(connector.ownerId, s"${connector.name} credential", credential).flatMap { credentialMeta =>
            tokenRepo.consume(hash).flatMap {
              case false =>
                // Lost the race (superseded/consumed/expired between validation and here) --
                // never leave the just-minted credential orphaned.
                connectorRepo.compensateDeleteCredential(credentialMeta.id, connector.ownerId).map(_ => Left(RefusalError))
              case true =>
                connectorRepo.repointPendingCredential(connector.id, credentialMeta.id, completedBy).flatMap {
                  case true => Future.successful(Right(()))
                  case false =>
                    connectorRepo.compensateDeleteCredential(credentialMeta.id, connector.ownerId).map(_ => Left(RefusalError))
                }
            }
          }
      }
}

object ConnectorCompletionService {
  private val rng = new SecureRandom()

  final case class MintedToken(connectorId: ConnectorId, rawToken: String, expiresAt: Instant)

  val AnonymousCompletedBy = "anonymous"

  /** Byte-identical curated refusal for every completion failure mode (design.md D5) -- never
   *  distinguishes unknown/expired/consumed/superseded/wrong-owner/gone. */
  val RefusalError: ServiceError = ServiceError.BadRequest("This completion link is invalid or has expired")

  /** CSPRNG, 32 bytes, base64url unpadded -- reuses `ShareTokenService`'s exact generation
   *  shape (design.md D2: "reuse it, do not add a second hashing helper" -- same principle
   *  extended to token generation). */
  def generateRawToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    Base64.getUrlEncoder.withoutPadding().encodeToString(bytes)
  }

  /** `min(configured, 24h)` clamp (design.md D9) applied to an operator-configured expiry read
   *  from the environment. */
  def clampExpiry(configuredMinutes: Option[String]): Duration = {
    val ceiling = Duration.ofHours(24)
    val parsed = configuredMinutes.flatMap(s => Try(s.trim.toLong).toOption).map(Duration.ofMinutes)
    parsed match {
      case Some(d) if d.compareTo(ceiling) > 0 => ceiling
      case Some(d) if d.compareTo(Duration.ZERO) <= 0 => Duration.ofMinutes(60)
      case Some(d) => d
      case None    => Duration.ofMinutes(60)
    }
  }
}
