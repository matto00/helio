package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-484 — the drift-detection mechanism design.md Decision 3 calls for: a test that FAILS if a
 *  source kind is added to `DataSourceKind`/a new `DataSource` subtype without a matching
 *  `ConnectorRegistry` registration, or vice versa. Both sets below are asserted against a literal
 *  kind-name set written independently in this file (not derived from either production value) —
 *  the point being that a typo'd `kind` on a hand-authored registry entry, or a new
 *  `DataSource` subtype's `kind` string added without updating the registry, fails this spec even
 *  though `DataSourceKind.All` trivially equals `ConnectorRegistry.all.map(_.kind).toSet` by
 *  construction post-HEL-484. */
class ConnectorRegistrySpec extends AnyWordSpec with Matchers {

  // Independently authored — NOT derived from ConnectorRegistry.all or
  // DataSourceKind.All. If either production value drifts from this set
  // (a kind added/removed on one side only), one of the assertions below fails.
  private val expectedKinds: Set[String] =
    Set("csv", "rest_api", "sql", "static", "text", "pdf", "image")

  "ConnectorRegistry.all" should {

    "contain exactly one entry per source kind, matching the independently-authored kind set" in {
      ConnectorRegistry.all.map(_.kind).toSet shouldBe expectedKinds
      ConnectorRegistry.all should have size 7
    }

    "equal DataSourceKind.All (pins the derivation invariant against a future literal-Set regression)" in {
      ConnectorRegistry.all.map(_.kind).toSet shouldBe DataSourceKind.All
    }

    "also match the independently-authored kind set via DataSourceKind.All" in {
      DataSourceKind.All shouldBe expectedKinds
    }

    "source the sql entry from SqlConnector.metadata, dependency-free" in {
      ConnectorRegistry.all.find(_.kind == "sql") shouldBe Some(SqlConnector.metadata)
    }

    "source the rest_api entry from RestApiConnector.metadata (companion object), dependency-free" in {
      ConnectorRegistry.all.find(_.kind == "rest_api") shouldBe Some(RestApiConnector.metadata)
    }
  }

  "ConnectorRegistry SQL/REST requiredFields" should {

    // Explicit lists (not reflection) — matches SqlSourceConfigPayload's 7
    // fields (DataSourceProtocol.scala), all required; `password` is secret.
    "match SqlSourceConfigPayload's required field names" in {
      val sql = ConnectorRegistry.all.find(_.kind == "sql").get
      sql.requiredFields.map(_.name) shouldBe Vector(
        "dialect", "host", "port", "database", "user", "password", "query"
      )
      sql.requiredFields.find(_.name == "password").map(_.secret) shouldBe Some(true)
    }

    // RestApiConfigPayload's only non-Option field is `url`; method/auth/headers
    // are all Option — not enumerated as top-level required fields.
    "match RestApiConfigPayload's required field names" in {
      val rest = ConnectorRegistry.all.find(_.kind == "rest_api").get
      rest.requiredFields.map(_.name) shouldBe Vector("url")
      rest.requiredFields.head.secret shouldBe false
    }
  }

  "DataSourceKind.parseKind" should {

    "still accept exactly the same 7 kind strings post-derivation" in {
      expectedKinds.foreach { kind =>
        DataSourceKind.parseKind(kind) shouldBe Right(kind)
      }
    }

    "still reject an unknown kind with the same error message shape" in {
      DataSourceKind.parseKind("unknown") shouldBe
        Left(s"Unknown source type: 'unknown'. Valid values: ${expectedKinds.toSeq.sorted.mkString(", ")}")
    }
  }
}
