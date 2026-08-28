package com.helio.api.protocols.auth

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.ApiToken
import spray.json._


/** `expiresInDays` is optional: absent on the wire means a non-expiring token.
 *  spray-json omits `None` when writing and reads a missing field as `None`,
 *  so no normalization beyond validation is needed.
 *
 *  `scopedPipelineIds` (HEL-369) is likewise optional: absent means today's
 *  unscoped, full-access token. When present it must be a non-empty array of
 *  pipeline ids the caller owns or has editor access to -- see
 *  `RequestValidation.validateCreateApiTokenRequest` (shape) and
 *  `ApiTokenService.create` (ownership/role check). */
final case class CreateApiTokenRequest(name: String, expiresInDays: Option[Int], scopedPipelineIds: Option[Seq[String]] = None)

/** The ONLY response that ever carries the raw token — returned once at
 *  creation. Every other read surface exposes metadata only. */
final case class CreateApiTokenResponse(
    id: String,
    name: String,
    token: String,
    createdAt: String,
    expiresAt: Option[String]
)

/** List/read shape: metadata only — never the raw token, never the hash.
 *  `scopedPipelineIds` (HEL-369) surfaces the token's allow-list for
 *  audit/visibility; absent for an unscoped token. */
final case class ApiTokenResponse(
    id: String,
    name: String,
    createdAt: String,
    lastUsedAt: Option[String],
    expiresAt: Option[String],
    scopedPipelineIds: Option[Seq[String]] = None
)

object ApiTokenResponse {
  def fromDomain(token: ApiToken): ApiTokenResponse =
    ApiTokenResponse(
      id                = token.id.value,
      name              = token.name,
      createdAt         = token.createdAt.toString,
      lastUsedAt        = token.lastUsedAt.map(_.toString),
      expiresAt         = token.expiresAt.map(_.toString),
      scopedPipelineIds = token.scopedPipelineIds.map(_.toVector.sorted)
    )
}

trait ApiTokenProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createApiTokenRequestFormat: RootJsonFormat[CreateApiTokenRequest]   = jsonFormat3(CreateApiTokenRequest.apply)
  implicit val createApiTokenResponseFormat: RootJsonFormat[CreateApiTokenResponse] = jsonFormat5(CreateApiTokenResponse.apply)
  implicit val apiTokenResponseFormat: RootJsonFormat[ApiTokenResponse]             = jsonFormat6(ApiTokenResponse.apply)
}
