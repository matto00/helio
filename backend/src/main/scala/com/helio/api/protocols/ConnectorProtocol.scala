package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Connector registry API types (HEL-484) ───────────────────────────────────

/** Wire shape for one `ConnectorFieldDescriptor` — a name/label/secret-flag
 *  descriptor only, never a value. */
final case class ConnectorFieldDescriptorResponse(name: String, label: String, secret: Boolean)

/** Wire shape for one `ConnectorMetadata` entry, as returned by
 *  `GET /api/connectors` and the `list_connectors` MCP tool. */
final case class ConnectorMetadataResponse(
    kind: String,
    displayName: String,
    supportsIncremental: Boolean,
    authKind: String,
    requiredFields: Vector[ConnectorFieldDescriptorResponse]
)

object ConnectorMetadataResponse {
  def fromDomain(metadata: ConnectorMetadata): ConnectorMetadataResponse =
    ConnectorMetadataResponse(
      kind                = metadata.kind,
      displayName         = metadata.displayName,
      supportsIncremental = metadata.supportsIncremental,
      authKind            = metadata.authKind,
      requiredFields      = metadata.requiredFields.map(f =>
        ConnectorFieldDescriptorResponse(name = f.name, label = f.label, secret = f.secret)
      )
    )
}

trait ConnectorProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val connectorFieldDescriptorResponseFormat: RootJsonFormat[ConnectorFieldDescriptorResponse] =
    jsonFormat3(ConnectorFieldDescriptorResponse.apply)
  implicit val connectorMetadataResponseFormat: RootJsonFormat[ConnectorMetadataResponse] =
    jsonFormat5(ConnectorMetadataResponse.apply)
}
