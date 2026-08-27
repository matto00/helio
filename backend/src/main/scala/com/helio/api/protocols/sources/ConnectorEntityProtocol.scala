package com.helio.api.protocols.sources

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._

// ── Connector entity API types (HEL-821) ─────────────────────────────────────
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
    dependentCount: Int
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
    host: String
)

object ConnectorSummary {
  def fromDomain(connector: Connector): ConnectorSummary =
    ConnectorSummary(
      id   = connector.id.value,
      name = connector.name,
      kind = connector.kind,
      host = connector.baseUrl
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
      dependentCount = dependentCount
    )
}

trait ConnectorEntityProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val connectorMetaFormat: RootJsonFormat[ConnectorMeta]         = jsonFormat9(ConnectorMeta.apply)
  implicit val connectorsResponseFormat: RootJsonFormat[ConnectorsResponse] = jsonFormat1(ConnectorsResponse.apply)
  implicit val connectorSummaryFormat: RootJsonFormat[ConnectorSummary]     = jsonFormat4(ConnectorSummary.apply)
  implicit val createConnectorRequestFormat: RootJsonFormat[CreateConnectorRequest] = jsonFormat5(CreateConnectorRequest.apply)
  implicit val updateConnectorRequestFormat: RootJsonFormat[UpdateConnectorRequest] = jsonFormat3(UpdateConnectorRequest.apply)
  implicit val rotateConnectorCredentialRequestFormat: RootJsonFormat[RotateConnectorCredentialRequest] =
    jsonFormat1(RotateConnectorCredentialRequest.apply)
}
