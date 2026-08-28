package com.helio.api.protocols.sources

import com.helio.api.protocols.workspace.{
  WorkspaceContextAgentSection,
  WorkspaceContextCounts,
  WorkspaceContextProtocol,
  WorkspaceContextResponse
}
import com.helio.domain.model.{Connector, ConnectorCredentialId, ConnectorId, UserId}
import com.helio.services.workspace.WorkspaceContextBudget
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-829 tasks.md 3.5 (design.md Decision 4c) — the structural pin on the connector→model
 *  surface, replacing the vacuous `services/workspace` token grep (round 2 CR-2 finding:
 *  `WorkspaceContextService` never contains the literal word "credential" — it carries
 *  `ConnectorSummary` by field reference, so a token grep there would be vacuously green
 *  forever). Two assertions:
 *
 *  (a) `ConnectorSummary`'s wire formatter's field count/name set, pinned directly — fails if a
 *      field is ever added to `ConnectorSummary`/its formatter without a matching update here.
 *  (b) A serialized `WorkspaceContext` payload for a workspace containing a Connector whose
 *      `config` carries a known non-real test credential-shaped string does not contain that
 *      string anywhere in the JSON — proving `ConnectorSummary.fromDomain`'s allow-listed
 *      construction (never reading `config`) actually holds, not just today. */
class ConnectorSummaryCredentialAbsenceSpec extends AnyWordSpec with Matchers with WorkspaceContextProtocol {

  private val now = Instant.parse("2026-01-01T00:00:00Z")

  // Obviously-fake test value only — never a real credential/token.
  private val fakeCredentialMarker = "test-fake-connector-credential-do-not-use"

  "ConnectorSummary's wire formatter" should {
    "pin the exact {id, name, kind, host} field set — no fifth field, ever silently added" in {
      val summary = ConnectorSummary(id = "conn-1", name = "Stripe", kind = "rest_api", host = "https://api.stripe.com")
      val json    = summary.toJson.asJsObject

      json.fields.keySet shouldBe Set("id", "name", "kind", "host")
    }
  }

  "a serialized WorkspaceContext payload carrying a credentialed Connector" should {
    "never contain that Connector's credential-shaped config string anywhere in the JSON" in {
      // `config` deliberately carries the fake marker — Connector.config is documented as
      // "non-secret extras only" and ConnectorSummary.fromDomain never reads it at all, but this
      // proves the absence structurally rather than assuming the field is never populated with
      // something credential-shaped by a future bug.
      val connector = Connector(
        id           = ConnectorId(UUID.randomUUID().toString),
        ownerId      = UserId(UUID.randomUUID().toString),
        name         = "Stripe",
        kind         = "rest_api",
        baseUrl      = "https://api.stripe.com",
        config       = s"""{"authType":"bearer","leakedCredential":"$fakeCredentialMarker"}""",
        credentialId = ConnectorCredentialId(UUID.randomUUID().toString),
        createdAt    = now,
        updatedAt    = now
      )

      val summary = ConnectorSummary.fromDomain(connector)
      val response = WorkspaceContextResponse(
        generatedAt  = now.toString,
        counts       = WorkspaceContextCounts(dataSources = 0, dataTypes = 0, pipelines = 0, dashboards = 0),
        dataSources  = Vector.empty,
        dataTypes    = Vector.empty,
        pipelines    = Vector.empty,
        dashboards   = Vector.empty,
        joinHints    = Vector.empty,
        truncation   = WorkspaceContextBudget.PlaceholderTruncation,
        agentContext = WorkspaceContextAgentSection.empty,
        connectors   = Vector(summary)
      )

      val serialized = response.toJson.compactPrint

      serialized should not include fakeCredentialMarker
      serialized should include(""""id":"""" + connector.id.value + "\"")
    }
  }
}
