package com.helio.api.protocols.auth

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** Wire shapes of the helio-mcp refresh-family routes (HEL-1713). Every hash is a lowercase SHA-256 hex
 *  string: helio-mcp never sends the refresh token, its id or the client id itself. Contracts:
 *  `schemas/mcp/mcp-refresh-family-*.schema.json`. */
final case class McpRefreshFamilyCreateRequest(clientIdHash: String, resource: String, jtiHash: String)
final case class McpRefreshFamilyCreateResponse(familyId: String, expiresAt: String)

final case class McpRefreshFamilyRotateRequest(
    clientIdHash: String,
    resource: String,
    presentedJtiHash: String,
    nextJtiHash: String
)
final case class McpRefreshFamilyRotateResponse(generation: Int, expiresAt: String)

/** The `409` body: `reason` is `reused`, `expired` or `mismatch`. */
final case class McpRefreshFamilyConflictResponse(reason: String)

trait McpRefreshFamilyProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createMcpRefreshFamilyRequestFormat: RootJsonFormat[McpRefreshFamilyCreateRequest] =
    jsonFormat3(McpRefreshFamilyCreateRequest.apply)
  implicit val createMcpRefreshFamilyResponseFormat: RootJsonFormat[McpRefreshFamilyCreateResponse] =
    jsonFormat2(McpRefreshFamilyCreateResponse.apply)
  implicit val rotateMcpRefreshFamilyRequestFormat: RootJsonFormat[McpRefreshFamilyRotateRequest] =
    jsonFormat4(McpRefreshFamilyRotateRequest.apply)
  implicit val rotateMcpRefreshFamilyResponseFormat: RootJsonFormat[McpRefreshFamilyRotateResponse] =
    jsonFormat2(McpRefreshFamilyRotateResponse.apply)
  implicit val mcpRefreshFamilyConflictResponseFormat: RootJsonFormat[McpRefreshFamilyConflictResponse] =
    jsonFormat1(McpRefreshFamilyConflictResponse.apply)
}
