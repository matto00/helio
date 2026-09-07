package com.helio.api.protocols.sources

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._

//
// Distinct from `ConnectorProtocol.scala` (HEL-484/825, `GET /api/connector-types`
// metadata) -- see design.md Decision 7. `ConnectorMeta` structurally cannot carry
// a secret: no field here is capable of holding the raw or ciphertext credential
// value, mirroring `ConnectorCredentialMeta`'s own doc comment.

/** Wire shape for a persisted Connector -- id/name/kind/baseUrl/config/timestamps
 *  only. Never the credential value in any form. */
final case class ConnectorMeta(
    id: String,
    ownerId: String,
    name: String,
    kind: String,
    baseUrl: String,
    config: JsValue,
    createdAt: String,
    updatedAt: String,
    dependentCount: Int,
    // HEL-955 design.md D1/D10: structural pendingness (credentialId.isEmpty), plus the
    // owner-visible completion signal -- surfaced on the owner-facing connectors list (task 6.3).
    pending: Boolean,
    completedAt: Option[String],
    completedBy: Option[String]
)

final case class ConnectorsResponse(items: Vector[ConnectorMeta])

/** HEL-828 design.md Decision 6: a dedicated, explicitly allow-listed projection of a
 *  Connector for agent-facing surfaces (list_connectors, workspace-context fan-outs) —
 *  `id`/`name`/`kind`/`host` ONLY, built by naming exactly those four fields off the domain
 *  `Connector`. NEVER derived from `ConnectorMeta`/`ConnectorAuthShape` by omission or
 *  subtraction — `config`/`defaultHeaders`/`authType` are never read into this type's
 *  construction at all, because `ConnectorAuthShape.defaultHeaders` is free-form,
 *  user-supplied header data that can itself hold a credential-shaped value (e.g. a custom
 *  `Authorization` header). `host` = the Connector's `baseUrl`. */
final case class ConnectorSummary(
    id: String,
    name: String,
    kind: String,
    host: String,
    // HEL-955 design.md D4a/D6: an agent must not mistake a pending Connector for a usable one.
    // No field describing the auth shape a human is mid-configuring, and never the completion
    // token -- see D6.
    pending: Boolean
)

object ConnectorSummary {
  def fromDomain(connector: Connector): ConnectorSummary =
    ConnectorSummary(
      id      = connector.id.value,
      name    = connector.name,
      kind    = connector.kind,
      host    = connector.baseUrl,
      pending = connector.isPending
    )
}

/** Create request -- accepts the credential value once, at creation time only.
 *  Never echoed back on any response. */
final case class CreateConnectorRequest(
    name: String,
    kind: String,
    baseUrl: String,
    config: Option[JsValue],
    credential: String
)

/** Update request -- non-secret fields only. Deliberately has NO credential
 *  field: `ConnectorEntityRoutes` inspects the raw request body for a
 *  credential/secret key and rejects it with 400 (design.md Decision 3)
 *  before this type is ever unmarshalled from a body containing one. */
final case class UpdateConnectorRequest(
    name: Option[String],
    baseUrl: Option[String],
    config: Option[JsValue]
)

/** Credential rotation request (HEL-824 design.md Decision 1) -- write-only, dedicated from
 *  `UpdateConnectorRequest` so a rotated secret can never ride along in a general-purpose PATCH
 *  body. */
final case class RotateConnectorCredentialRequest(credential: String)

object ConnectorMeta {
  def fromDomain(connector: Connector, dependentCount: Int): ConnectorMeta =
    ConnectorMeta(
      id             = connector.id.value,
      ownerId        = connector.ownerId.value,
      name           = connector.name,
      kind           = connector.kind,
      baseUrl        = connector.baseUrl,
      config         = connector.config.parseJson,
      createdAt      = connector.createdAt.toString,
      updatedAt      = connector.updatedAt.toString,
      dependentCount = dependentCount,
      pending        = connector.isPending,
      completedAt    = connector.completedAt.map(_.toString),
      completedBy    = connector.completedBy
    )
}

/** HEL-955 task 4.6a: response shape for both `create_connector`'s completion-URL mint and the
 *  owner re-mint endpoint (`POST /api/connectors/:id/completion-token`) -- the ONLY responses
 *  that ever carry the token secret, never re-readable afterwards (design.md D9). */
final case class CompletionTokenResponse(connectorId: String, token: String, expiresAt: String)

/** HEL-955 task 4.2: completion request body -- token and credential travel together, never in
 *  the query string (design.md D5). */
final case class CompletionRequest(token: String, credential: String)

/** HEL-955 evaluation-1.md CR4: the completion page's GET-shaped lookup response -- the pending
 *  Connector's intended auth shape ONLY (authType + api-key placement metadata). Deliberately a
 *  narrow, dedicated type rather than `ConnectorAuthShape` itself -- excludes `defaultHeaders`
 *  (free-form, potentially credential-shaped, HEL-828's own concern) and the server-owned
 *  `implicit` flag, neither of which the completion page needs to render its form. */
final case class PendingConnectorAuthShapeResponse(
    authType: String,
    apiKeyName: Option[String],
    apiKeyPlacement: Option[String]
)

/** HEL-955 task 5.1: `create_connector`'s credentialed-host request body -- the intended auth
 *  shape (design.md D9: "the auth shape is part of the [re-mint match] key"), never a
 *  credential value -- that arrives later, out-of-band, through the completion endpoint. */
final case class CreatePendingConnectorRequest(
    name: String,
    kind: String,
    baseUrl: String,
    authType: String,
    apiKeyName: Option[String] = None,
    apiKeyPlacement: Option[String] = None
)

trait ConnectorEntityProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val connectorMetaFormat: RootJsonFormat[ConnectorMeta]         = jsonFormat12(ConnectorMeta.apply)
  implicit val connectorsResponseFormat: RootJsonFormat[ConnectorsResponse] = jsonFormat1(ConnectorsResponse.apply)
  implicit val connectorSummaryFormat: RootJsonFormat[ConnectorSummary]     = jsonFormat5(ConnectorSummary.apply)
  implicit val createConnectorRequestFormat: RootJsonFormat[CreateConnectorRequest] = jsonFormat5(CreateConnectorRequest.apply)
  implicit val updateConnectorRequestFormat: RootJsonFormat[UpdateConnectorRequest] = jsonFormat3(UpdateConnectorRequest.apply)
  implicit val rotateConnectorCredentialRequestFormat: RootJsonFormat[RotateConnectorCredentialRequest] =
    jsonFormat1(RotateConnectorCredentialRequest.apply)
  implicit val completionTokenResponseFormat: RootJsonFormat[CompletionTokenResponse] = jsonFormat3(CompletionTokenResponse.apply)
  implicit val completionRequestFormat: RootJsonFormat[CompletionRequest]             = jsonFormat2(CompletionRequest.apply)
  implicit val createPendingConnectorRequestFormat: RootJsonFormat[CreatePendingConnectorRequest] =
    jsonFormat6(CreatePendingConnectorRequest.apply)
  implicit val pendingConnectorAuthShapeResponseFormat: RootJsonFormat[PendingConnectorAuthShapeResponse] =
    jsonFormat3(PendingConnectorAuthShapeResponse.apply)
}
