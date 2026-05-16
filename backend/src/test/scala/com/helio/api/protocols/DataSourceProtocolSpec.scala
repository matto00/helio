package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.domain.{CsvSourceConfig, RestApiConfig, SqlSourceConfig}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Round-trip tests for the discriminated-union [[DataSourceResponse]] format.
 *
 *  Each subtype is asserted to serialize with the correct `"type"`
 *  discriminator and to deserialize back into the same case class. */
class DataSourceProtocolSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private def roundTrip(d: DataSourceResponse): DataSourceResponse =
    d.toJson.convertTo[DataSourceResponse]

  "DataSourceResponse discriminated-union format" should {

    "emit `type: csv` and round-trip a CsvSourceResponse" in {
      val r: DataSourceResponse = CsvSourceResponse(
        id        = "ds-csv",
        name      = "csv-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = CsvSourceConfigPayload("uploads/test.csv")
      )
      val json = r.toJson.asJsObject
      json.fields("type")                            shouldBe JsString("csv")
      json.fields("config").asJsObject.fields("path") shouldBe JsString("uploads/test.csv")
      roundTrip(r) shouldBe r
    }

    "emit `type: rest_api` and round-trip a RestSourceResponse" in {
      val r: DataSourceResponse = RestSourceResponse(
        id        = "ds-rest",
        name      = "rest-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = RestApiConfigPayload(url = "http://example.com", method = Some("GET"), auth = None, headers = None)
      )
      val json = r.toJson.asJsObject
      json.fields("type")                            shouldBe JsString("rest_api")
      json.fields("config").asJsObject.fields("url") shouldBe JsString("http://example.com")
      roundTrip(r) shouldBe r
    }

    "emit `type: sql` and round-trip a SqlSourceResponse" in {
      val r: DataSourceResponse = SqlSourceResponse(
        id        = "ds-sql",
        name      = "sql-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = SqlSourceConfigPayload("postgresql", "host", 5432, "db", "u", "p", "SELECT 1")
      )
      val json = r.toJson.asJsObject
      json.fields("type")                              shouldBe JsString("sql")
      json.fields("config").asJsObject.fields("query") shouldBe JsString("SELECT 1")
      roundTrip(r) shouldBe r
    }

    "emit `type: static` (no config) and round-trip a StaticSourceResponse" in {
      val r: DataSourceResponse = StaticSourceResponse(
        id        = "ds-static",
        name      = "static-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z"
      )
      val json = r.toJson.asJsObject
      json.fields("type")           shouldBe JsString("static")
      json.fields.contains("config") shouldBe false
      roundTrip(r) shouldBe r
    }

    "reject deserialization when 'type' discriminator is missing" in {
      val obj = JsObject("id" -> JsString("x"), "name" -> JsString("y"),
                         "createdAt" -> JsString("t"), "updatedAt" -> JsString("t"))
      a [DeserializationException] should be thrownBy obj.convertTo[DataSourceResponse]
    }
  }

  "DataSourceConfigCodec" should {

    "round-trip CSV config" in {
      val cfg     = CsvSourceConfig("uploads/x.csv")
      val encoded = DataSourceConfigCodec.encodeCsv(cfg)
      DataSourceConfigCodec.decodeCsv(encoded) shouldBe cfg
    }

    "tolerate the legacy `filePath` key on CSV configs (HEL-237)" in {
      val raw     = JsObject("filePath" -> JsString("/legacy/path.csv")).compactPrint
      DataSourceConfigCodec.decodeCsv(raw).path shouldBe "/legacy/path.csv"
    }

    "round-trip REST config (NoAuth)" in {
      val cfg     = RestApiConfig(url = "http://example.com", method = "POST", headers = Map("h" -> "v"))
      val encoded = DataSourceConfigCodec.encodeRest(cfg)
      DataSourceConfigCodec.decodeRest(encoded) shouldBe cfg
    }

    "round-trip SQL config" in {
      val cfg     = SqlSourceConfig("postgresql", "host", 5432, "db", "u", "p", "SELECT 1")
      val encoded = DataSourceConfigCodec.encodeSql(cfg)
      DataSourceConfigCodec.decodeSql(encoded) shouldBe cfg
    }
  }

  "DataSourceResponse.fromDomain credential redaction" should {
    import com.helio.domain.{ApiKeyPlacement, DataSourceId, RestApiAuth, RestSource, SqlSource, UserId}
    import java.time.Instant

    val now   = Instant.parse("2026-05-14T00:00:00Z")
    val owner = UserId("00000000-0000-0000-0000-000000000001")
    val id    = DataSourceId("ds-redact")

    "redact REST bearer tokens" in {
      val src = RestSource(id, "rest", owner, now, now,
        RestApiConfig(url = "https://example.com", method = "GET",
          auth = RestApiAuth.BearerAuth("super-secret-token")))
      val resp = DataSourceResponse.fromDomain(src).asInstanceOf[RestSourceResponse]
      resp.config.auth.flatMap(_.token) shouldBe Some("***")
    }

    "redact REST api-key values" in {
      val src = RestSource(id, "rest", owner, now, now,
        RestApiConfig(url = "https://example.com", method = "GET",
          auth = RestApiAuth.ApiKeyAuth("X-Api-Key", "super-secret", ApiKeyPlacement.Header)))
      val resp = DataSourceResponse.fromDomain(src).asInstanceOf[RestSourceResponse]
      resp.config.auth.flatMap(_.value) shouldBe Some("***")
      // The key name (non-credential) is preserved.
      resp.config.auth.flatMap(_.name)  shouldBe Some("X-Api-Key")
    }

    "redact SQL passwords (non-empty)" in {
      val src = SqlSource(id, "sql", owner, now, now,
        SqlSourceConfig("postgresql", "host", 5432, "db", "user", "real-password", "SELECT 1"))
      val resp = DataSourceResponse.fromDomain(src).asInstanceOf[SqlSourceResponse]
      resp.config.password shouldBe "***"
      // Other fields are preserved.
      resp.config.user     shouldBe "user"
      resp.config.query    shouldBe "SELECT 1"
    }

    "leave empty SQL passwords untouched (no spurious redaction)" in {
      val src = SqlSource(id, "sql", owner, now, now,
        SqlSourceConfig("postgresql", "host", 5432, "db", "user", "", "SELECT 1"))
      val resp = DataSourceResponse.fromDomain(src).asInstanceOf[SqlSourceResponse]
      resp.config.password shouldBe ""
    }
  }
}
