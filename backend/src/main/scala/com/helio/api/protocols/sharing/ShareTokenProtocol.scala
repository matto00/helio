package com.helio.api.protocols.sharing

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.ShareToken
import spray.json._

/** `expiresAt` is an ISO-8601 instant string; omitted (never `false`/`null`) means non-expiring,
 *  matching this codebase's spray-json `Option`-omits-`None` convention (see `ApiTokenService`'s
 *  own `expiresInDays`/`expiresAt` wire shape). */
final case class CreateShareTokenRequest(expiresAt: Option[String])

/** Metadata-only shape for list -- never carries the raw secret (design.md D2/schemas task 4.1).
 *  `revokedAt` is `Some` only once revoked; a caller derives Active/Expired/Revoked purely from
 *  `expiresAt`/`revokedAt` plus wall-clock, following the same "no state enum on the wire" pattern
 *  the rest of this API uses (e.g. pipeline run status is inferred, not persisted redundantly). */
final case class ShareTokenResponse(
    id: String,
    dashboardId: String,
    expiresAt: Option[String],
    revokedAt: Option[String],
    createdAt: String
)

final case class ShareTokensResponse(items: Vector[ShareTokenResponse])

/** The ONE response shape that ever carries the raw secret -- returned once, at creation
 *  (design.md D2/D8). Deliberately carries no fully-qualified share URL: the client composes it
 *  from `window.location.origin` (design.md D8's "no backend public-origin config" rationale). */
final case class CreateShareTokenResponse(
    id: String,
    dashboardId: String,
    token: String,
    expiresAt: Option[String],
    createdAt: String
)

object ShareTokenResponse {
  def fromDomain(token: ShareToken): ShareTokenResponse =
    ShareTokenResponse(
      id          = token.id.value,
      dashboardId = token.dashboardId.value,
      expiresAt   = token.expiresAt.map(_.toString),
      revokedAt   = token.revokedAt.map(_.toString),
      createdAt   = token.createdAt.toString
    )
}

trait ShareTokenProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createShareTokenRequestFormat: RootJsonFormat[CreateShareTokenRequest] =
    jsonFormat1(CreateShareTokenRequest.apply)
  implicit val shareTokenResponseFormat: RootJsonFormat[ShareTokenResponse] =
    jsonFormat5(ShareTokenResponse.apply)
  implicit val shareTokensResponseFormat: RootJsonFormat[ShareTokensResponse] =
    jsonFormat1(ShareTokensResponse.apply)
  implicit val createShareTokenResponseFormat: RootJsonFormat[CreateShareTokenResponse] =
    jsonFormat5(CreateShareTokenResponse.apply)
}
