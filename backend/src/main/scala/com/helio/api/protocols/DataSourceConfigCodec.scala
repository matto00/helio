package com.helio.api.protocols

import com.helio.domain.{
  CsvSourceConfig,
  ImageSourceConfig,
  PdfSourceConfig,
  RestApiConfig,
  SqlSourceConfig,
  TextSourceConfig
}
import spray.json._

/** Encode / decode typed `DataSource` config to / from the JSON string stored
 *  on the `data_sources.config` column.
 *
 *  Lives in the protocol package because it shares formatter declarations
 *  with the per-subtype request/response payloads. Keeping the codec here
 *  avoids duplicating spray-json wiring in the repository.
 *
 *  Legacy CSV configs that stored their path under `filePath` (HEL-237) are
 *  tolerated transparently — the decoder falls back to that key when `path`
 *  is missing. */
object DataSourceConfigCodec extends DefaultJsonProtocol {

  private implicit val csvCfgFmt: RootJsonFormat[CsvSourceConfigPayload] = jsonFormat1(CsvSourceConfigPayload.apply)
  private implicit val sqlCfgFmt: RootJsonFormat[SqlSourceConfigPayload] = jsonFormat7(SqlSourceConfigPayload.apply)
  private implicit val restAuthFmt: RootJsonFormat[RestApiAuthPayload]   = jsonFormat5(RestApiAuthPayload.apply)
  private implicit val restCfgFmt: RootJsonFormat[RestApiConfigPayload]  = jsonFormat4(RestApiConfigPayload.apply)

  def decodeCsv(raw: String): CsvSourceConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val path = obj.fields.get("path").orElse(obj.fields.get("filePath")) match {
      case Some(JsString(p)) => p
      case _                 => ""
    }
    CsvSourceConfig(path)
  }

  def encodeCsv(cfg: CsvSourceConfig): String =
    JsObject("path" -> JsString(cfg.path)).compactPrint

  /** Decode REST config. Empty / partial / malformed stored blobs (seeded
   *  fixtures from the pre-CS2c-2 era) fall back to a minimal `RestApiConfig`
   *  with an empty URL — the engine paths that reject REST sources at the
   *  route layer never read the URL, so a placeholder is safe. */
  def decodeRest(raw: String): RestApiConfig =
    try {
      RestApiConfigPayload.toDomain(JsonParser(raw).convertTo[RestApiConfigPayload])
        .getOrElse(RestApiConfig(url = ""))
    } catch {
      case _: DeserializationException => RestApiConfig(url = "")
      case _: NoSuchElementException   => RestApiConfig(url = "")
    }

  def encodeRest(cfg: RestApiConfig): String =
    RestApiConfigPayload.fromDomain(cfg).toJson.compactPrint

  /** Decode SQL config. Same tolerance as `decodeRest` — degenerate stored
   *  blobs decode to an empty `SqlSourceConfig`. */
  def decodeSql(raw: String): SqlSourceConfig =
    try {
      SqlSourceConfigPayload.toDomain(JsonParser(raw).convertTo[SqlSourceConfigPayload])
    } catch {
      case _: DeserializationException =>
        SqlSourceConfig(dialect = "", host = "", port = 0, database = "", user = "", password = "", query = "")
    }

  def encodeSql(cfg: SqlSourceConfig): String =
    SqlSourceConfigPayload.fromDomain(cfg).toJson.compactPrint

  /** Decode text-source config: `path` (always populated) + optional
   *  `sourceUrl` (present only for URL-ingested sources). */
  def decodeText(raw: String): TextSourceConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val path = obj.fields.get("path") match {
      case Some(JsString(p)) => p
      case _                 => ""
    }
    val sourceUrl = obj.fields.get("sourceUrl").collect { case JsString(u) => u }
    TextSourceConfig(path, sourceUrl)
  }

  def encodeText(cfg: TextSourceConfig): String =
    JsObject(
      Map("path" -> JsString(cfg.path)) ++ cfg.sourceUrl.map("sourceUrl" -> JsString(_))
    ).compactPrint

  /** Decode PDF-source config (HEL-214): identical shape to
   *  [[decodeText]] — `path` (always populated) + optional `sourceUrl`
   *  (present only for URL-ingested sources). */
  def decodePdf(raw: String): PdfSourceConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val path = obj.fields.get("path") match {
      case Some(JsString(p)) => p
      case _                 => ""
    }
    val sourceUrl = obj.fields.get("sourceUrl").collect { case JsString(u) => u }
    PdfSourceConfig(path, sourceUrl)
  }

  def encodePdf(cfg: PdfSourceConfig): String =
    JsObject(
      Map("path" -> JsString(cfg.path)) ++ cfg.sourceUrl.map("sourceUrl" -> JsString(_))
    ).compactPrint

  /** Decode image-source config: same shape as `TextSourceConfig` — `path`
   *  (always populated) + optional `sourceUrl` (present only for
   *  URL-ingested sources). */
  def decodeImage(raw: String): ImageSourceConfig = {
    val obj = JsonParser(raw) match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    val path = obj.fields.get("path") match {
      case Some(JsString(p)) => p
      case _                 => ""
    }
    val sourceUrl = obj.fields.get("sourceUrl").collect { case JsString(u) => u }
    ImageSourceConfig(path, sourceUrl)
  }

  def encodeImage(cfg: ImageSourceConfig): String =
    JsObject(
      Map("path" -> JsString(cfg.path)) ++ cfg.sourceUrl.map("sourceUrl" -> JsString(_))
    ).compactPrint
}
