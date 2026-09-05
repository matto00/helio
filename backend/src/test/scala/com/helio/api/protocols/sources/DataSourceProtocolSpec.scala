package com.helio.api.protocols.sources

import com.helio.api.protocols.sources.{CsvSourceConfigPayload, CsvSourceUrlRequest, RestApiConfigPayload, SqlSourceConfigPayload, TextSourceConfigPayload}
import com.helio.api.protocols.sources.{CsvSourceResponse, DataSourceConfigCodec, DataSourceResponse, RestSourceResponse, SqlSourceResponse, StaticSourceResponse, TextSourceResponse}
import com.helio.api.JsonProtocols
import com.helio.domain.model.{CsvSourceConfig, QueryParams, RestApiConfig, SqlSourceConfig, TextSourceConfig}
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

    "emit `type: csv` and round-trip a CsvSourceResponse carrying a sourceUrl (HEL-862)" in {
      val r: DataSourceResponse = CsvSourceResponse(
        id        = "ds-csv-url",
        name      = "csv-url-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = CsvSourceConfigPayload("csv/ds-csv-url.csv", Some("https://example.com/data.csv"))
      )
      val json = r.toJson.asJsObject
      json.fields("config").asJsObject.fields("sourceUrl") shouldBe JsString("https://example.com/data.csv")
      roundTrip(r) shouldBe r
    }

    "decode a CsvSourceUrlRequest JSON body (HEL-862 create-from-URL wire contract)" in {
      val json = """{"name":"URL CSV","type":"csv","config":{"url":"https://example.com/data.csv"}}""".parseJson
      val req  = json.convertTo[CsvSourceUrlRequest]
      req.name          shouldBe "URL CSV"
      req.`type`        shouldBe "csv"
      req.config.url    shouldBe "https://example.com/data.csv"
      req.tag           shouldBe None
    }

    "emit `type: rest_api` and round-trip a RestSourceResponse" in {
      val r: DataSourceResponse = RestSourceResponse(
        id        = "ds-rest",
        name      = "rest-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = RestApiConfigPayload(url = Some("http://example.com"), method = Some("GET"), auth = None, headers = None)
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

    "emit `type: text` and round-trip a TextSourceResponse (HEL-215)" in {
      val r: DataSourceResponse = TextSourceResponse(
        id        = "ds-text",
        name      = "text-src",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = TextSourceConfigPayload("text/ds-text.txt", Some("https://example.com/notes.txt"))
      )
      val json = r.toJson.asJsObject
      json.fields("type")                                 shouldBe JsString("text")
      json.fields("config").asJsObject.fields("path")      shouldBe JsString("text/ds-text.txt")
      json.fields("config").asJsObject.fields("sourceUrl") shouldBe JsString("https://example.com/notes.txt")
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

    "round-trip REST config (connectorId-referencing)" in {
      val cfg     = RestApiConfig(connectorId = "conn-1", endpoint = "/data", method = "POST", headers = Map("h" -> "v"))
      val encoded = DataSourceConfigCodec.encodeRest(cfg)
      DataSourceConfigCodec.decodeRest(encoded) shouldBe Right(cfg)
    }

    "decodeRest returns Left(\"legacy-unmigrated\") for a legacy url-shaped blob (HEL-822 Decision 6)" in {
      val raw = JsObject("url" -> JsString("http://example.com")).compactPrint
      DataSourceConfigCodec.decodeRest(raw) shouldBe Left("legacy-unmigrated")
    }

    "decodeRest returns a Left(\"malformed: ...\") for neither shape (HEL-822 Decision 6)" in {
      val raw = JsObject("foo" -> JsString("bar")).compactPrint
      DataSourceConfigCodec.decodeRest(raw) match {
        case Left(msg) => msg should startWith("malformed:")
        case other     => fail(s"expected Left(malformed: ...), got $other")
      }
    }

    // ── HEL-844 task 3.4: QueryParams dual-read round-trip ──

    "round-trips a QueryParams-array-shaped queryParams: array in -> array out -> same domain value" in {
      val cfg = RestApiConfig(
        connectorId = "conn-1",
        endpoint    = "/data",
        queryParams = QueryParams(Vector("tag" -> "a", "tag" -> "b"))
      )
      val encoded = DataSourceConfigCodec.encodeRest(cfg)
      encoded should include(""""queryParams":[""") // always WRITES the array shape (design.md D2)
      DataSourceConfigCodec.decodeRest(encoded) shouldBe Right(cfg)
    }

    "decodes a legacy JSON-object-shaped queryParams (already-persisted rows, HEL-844 design.md D3)" in {
      val raw = JsObject(
        "connectorId" -> JsString("conn-legacy"),
        "endpoint"    -> JsString("/data"),
        "queryParams" -> JsObject("limit" -> JsString("10"), "offset" -> JsString("0"))
      ).compactPrint

      DataSourceConfigCodec.decodeRest(raw) shouldBe Right(
        RestApiConfig(connectorId = "conn-legacy", endpoint = "/data", queryParams = QueryParams(Vector("limit" -> "10", "offset" -> "0")))
      )
    }

    // HEL-844 evaluation-1.md CR3 / skeptic-final-2.md: the test above uses a fixture whose
    // document order ("limit", "offset") happens to already be alphabetical, so it pins nothing
    // about ORDER -- only about the pairs decoding correctly at all. spray-json parses a JSON
    // object's fields into a `TreeMap` (`spray/json/JsonParser.scala:100`), so `QueryParams.read`'s
    // legacy `JsObject` branch yields KEY-SORTED order, not document order -- there is no
    // document-order information left to recover by the time `QueryParams.read` sees the parsed
    // `JsObject`. The fixture below is a HAND-WRITTEN string literal, deliberately NOT built via
    // `JsObject(...).compactPrint` -- `JsObject.apply`'s own `fields: Map[String, JsValue]` is
    // ALSO backed by a sorted map, so a `JsObject(...).compactPrint`-constructed fixture emits its
    // keys already alphabetized regardless of construction order, silently destroying the very
    // document-order-vs-key-sorted distinction this test exists to pin (this happened once
    // already in this branch: an earlier version of this test built the raw JSON via
    // `JsObject("z" -> ..., "a" -> ...).compactPrint`, which actually emitted
    // `{"a":"2","z":"1"}` -- already sorted -- so it could not have distinguished key-sorted decode
    // from document-order decode, despite its own comment claiming the opposite). The literal
    // below is confirmed (by printing it) to actually place "z" before "a" in the emitted string.
    "decodes a legacy JSON-object-shaped queryParams in KEY-SORTED order, not document order (HEL-844 design.md D2)" in {
      val raw = """{"connectorId":"conn-legacy-2","endpoint":"/data","queryParams":{"z":"1","a":"2"}}"""
      raw.indexOf("\"z\"") should be < raw.indexOf("\"a\"") // guards the fixture itself, not just the decode

      DataSourceConfigCodec.decodeRest(raw) shouldBe Right(
        RestApiConfig(connectorId = "conn-legacy-2", endpoint = "/data", queryParams = QueryParams(Vector("a" -> "2", "z" -> "1")))
      )
    }

    // ── HEL-844 task 3.5: a malformed queryParams value fails loud, is NEVER swallowed to empty ──

    "decodeRest returns Left(\"malformed: ...\") for a bare-string queryParams (HEL-844 D2/3.5)" in {
      val raw = JsObject(
        "connectorId" -> JsString("conn-1"),
        "queryParams" -> JsString("tag=a")
      ).compactPrint
      DataSourceConfigCodec.decodeRest(raw) match {
        case Left(msg) => msg should startWith("malformed:")
        case other     => fail(s"expected Left(malformed: ...), got $other")
      }
    }

    "decodeRest returns Left(\"malformed: ...\") for a queryParams array entry missing 'name' (HEL-844 D2/3.5)" in {
      val raw = JsObject(
        "connectorId" -> JsString("conn-1"),
        "queryParams" -> JsArray(JsObject("value" -> JsString("a")))
      ).compactPrint
      DataSourceConfigCodec.decodeRest(raw) match {
        case Left(msg) => msg should startWith("malformed:")
        case other     => fail(s"expected Left(malformed: ...), got $other")
      }
    }

    "round-trip SQL config" in {
      val cfg     = SqlSourceConfig("postgresql", "host", 5432, "db", "u", "p", "SELECT 1")
      val encoded = DataSourceConfigCodec.encodeSql(cfg)
      DataSourceConfigCodec.decodeSql(encoded) shouldBe cfg
    }

    "round-trip text config with a sourceUrl (URL ingestion)" in {
      val cfg     = TextSourceConfig("text/x.txt", Some("https://example.com/x.txt"))
      val encoded = DataSourceConfigCodec.encodeText(cfg)
      DataSourceConfigCodec.decodeText(encoded) shouldBe cfg
    }

    "round-trip text config without a sourceUrl (upload)" in {
      val cfg     = TextSourceConfig("text/y.md", None)
      val encoded = DataSourceConfigCodec.encodeText(cfg)
      DataSourceConfigCodec.decodeText(encoded) shouldBe cfg
    }
  }

  "DataSourceResponse.fromDomain credential redaction" should {
    import com.helio.domain.model.{ApiKeyPlacement, DataSourceId, RestApiAuth, RestSource, SqlSource, UserId}
    import java.time.Instant

    val now   = Instant.parse("2026-05-14T00:00:00Z")
    val owner = UserId("00000000-0000-0000-0000-000000000001")
    val id    = DataSourceId("ds-redact")

    // HEL-822: `RestApiConfig`/`RestApiConfigPayload` carry no credential at all anymore —
    // auth lives entirely on the referenced Connector, resolved separately. There is
    // structurally nothing left to redact on a REST source response; these two cases replace
    // the old bearer/api-key redaction assertions.
    "carry no auth/credential field on a REST source response" in {
      val src = RestSource(id, "rest", owner, now, now,
        RestApiConfig(connectorId = "conn-1", endpoint = "/data", method = "GET"))
      val resp = DataSourceResponse.fromDomain(src).asInstanceOf[RestSourceResponse]
      resp.config.auth shouldBe None
      resp.config.connectorId shouldBe Some("conn-1")
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

  // HEL-460: assertions against the *actual serialized JSON* of a response, not merely a helper's
  // return value — this is the check that would fail if the redaction seam were wired but bypassed
  // at the response boundary (e.g. a future `fromDomain` case that forgets to call
  // `SecretRedaction.redact`).
  "DataSourceResponse.fromDomain serialized JSON never leaks raw secrets" should {
    import com.helio.domain.model.{ApiKeyPlacement, DataSourceId, RestApiAuth, RestSource, SqlSource, UserId}
    import java.time.Instant

    val now   = Instant.parse("2026-05-14T00:00:00Z")
    val owner = UserId("00000000-0000-0000-0000-000000000001")
    val id    = DataSourceId("ds-redact-json")

    // HEL-822: no auth field remains on the REST source payload at all — the "never leaks"
    // guarantee is now structural (no `auth`/token/value key can appear), not a redaction
    // behavior to test.
    "never contain an auth/token/value key in a REST source's serialized JSON" in {
      val src = RestSource(id, "rest", owner, now, now,
        RestApiConfig(connectorId = "conn-1", endpoint = "/data", method = "GET"))
      val text = DataSourceResponse.fromDomain(src).toJson.compactPrint
      text should not include "token"
      text should not include "\"auth\""
    }

    "never contain the raw SQL password in the serialized JSON" in {
      val rawPassword = "super-secret-db-password-xyz"
      val src = SqlSource(id, "sql", owner, now, now,
        SqlSourceConfig("postgresql", "host", 5432, "db", "user", rawPassword, "SELECT 1"))
      val text = DataSourceResponse.fromDomain(src).toJson.compactPrint
      text should not include rawPassword
      text should include(""""password":"***"""")
    }
  }
}
