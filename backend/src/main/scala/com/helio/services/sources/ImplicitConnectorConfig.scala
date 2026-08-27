package com.helio.services.sources

import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model.{ApiKeyPlacement, RestApiAuth}

/** HEL-822 design.md Decision 1 (revised, round-2 CR4) / task 4.0: shared, PURE policy helper
 *  for both of Decision 1's dual-support synthesis points — task 1.2a's create-time bare-`url`
 *  path and task 4.1's startup migration path — so the naming convention, auth shape, and
 *  `implicit: true` flag can never drift between them. Each call site persists the result
 *  through its OWN layer (both land on `ConnectorRepository.create` directly, never
 *  `ConnectorEntityService.create` — neither has a request-scoped `ConnectorCreateRequest` to
 *  validate). */
object ImplicitConnectorConfig {

  /** Returns `(name, ConnectorAuthShape JSON, credential plaintext, credential name)`.
   *  `baseUrl` is accepted for call-site symmetry (both synthesis points already have it in
   *  hand) but not embedded in the returned tuple — the caller passes it straight to
   *  `ConnectorRepository.create`'s own `baseUrl` parameter. */
  def forLegacySource(name: String, @annotation.unused baseUrl: String, auth: RestApiAuth): (String, String, String, String) = {
    val (authType, apiKeyName, apiKeyPlacement, credentialPlaintext) = auth match {
      case RestApiAuth.NoAuth =>
        ("none", None, None, "")
      case RestApiAuth.BearerAuth(token) =>
        ("bearer", None, None, token)
      case RestApiAuth.ApiKeyAuth(keyName, value, placement) =>
        val placementStr = placement match {
          case ApiKeyPlacement.Header => "header"
          case ApiKeyPlacement.Query  => "query"
        }
        ("api_key", Some(keyName), Some(placementStr), value)
    }
    val configJson = ConnectorAuthShape.encode(
      ConnectorAuthShape(
        authType        = authType,
        apiKeyName      = apiKeyName,
        apiKeyPlacement = apiKeyPlacement,
        defaultHeaders  = Map.empty,
        `implicit`      = true
      )
    )
    (name, configJson, credentialPlaintext, s"$name credential")
  }
}
