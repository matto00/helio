package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.ApiToken
import spray.json._

// ── Personal Access Token types (HEL-148 agent-native layer, Phase 1) ────────

/** `expiresInDays` is optional: absent on the wire means a non-expiring token.
 *  spray-json omits `None` when writing and reads a missing field as `None`,
 *  so no normalization beyond validation is needed. */
final case class CreateApiTokenRequest(name: String, expiresInDays: Option[Int])

/** The ONLY response that ever carries the raw token — returned once at
 *  creation. Every other read surface exposes metadata only. */
final case class CreateApiTokenResponse(
    id: String,
    name: String,
    token: String,
    createdAt: String,
    expiresAt: Option[String]
)

/** List/read shape: metadata only — never the raw token, never the hash. */
final case class ApiTokenResponse(
    id: String,
    name: String,
    createdAt: String,
    lastUsedAt: Option[String],
    expiresAt: Option[String]
)

object ApiTokenResponse {
  def fromDomain(token: ApiToken): ApiTokenResponse =
    ApiTokenResponse(
      id         = token.id.value,
      name       = token.name,
      createdAt  = token.createdAt.toString,
      lastUsedAt = token.lastUsedAt.map(_.toString),
      expiresAt  = token.expiresAt.map(_.toString)
    )
}

trait ApiTokenProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createApiTokenRequestFormat: RootJsonFormat[CreateApiTokenRequest]   = jsonFormat2(CreateApiTokenRequest.apply)
  implicit val createApiTokenResponseFormat: RootJsonFormat[CreateApiTokenResponse] = jsonFormat5(CreateApiTokenResponse.apply)
  implicit val apiTokenResponseFormat: RootJsonFormat[ApiTokenResponse]             = jsonFormat5(ApiTokenResponse.apply)
}
