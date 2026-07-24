package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import com.helio.services.{HasSecrets, SecretField, SecretRedaction}
import spray.json._

// ── DataSource API types ─────────────────────────────────────────────────────
//
// CS2c-2 evolves the wire shape to a discriminated union over `type`. Each
// subtype emits its own typed `config` payload (StaticSource has no `config`
// field). The `DataSourceResponse` ADT mirrors the domain ADT; conversion is
// 1:1 with no `convertTo[X]` at consumer sites.

sealed trait DataSourceResponse {
  def id: String
  def name: String
  def createdAt: String
  def updatedAt: String
  /** Wire discriminator — emitted as the `"type"` JSON field by the
   *  discriminated-union formatter. Declared as `def` (not `val`) on the
   *  trait so concrete case classes don't introduce an extra constructor
   *  parameter that confuses the spray-json macro. */
  def `type`: String
}

final case class CsvSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: CsvSourceConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Csv
}

final case class RestSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: RestApiConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.RestApi
}

final case class SqlSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: SqlSourceConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Sql
}

final case class StaticSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Static
}

final case class TextSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: TextSourceConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Text
}

final case class PdfSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: PdfSourceConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Pdf
}

final case class ImageSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: ImageSourceConfigPayload
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Image
}

final case class DataSourcesResponse(items: Vector[DataSourceResponse])
final case class UpdateDataSourceRequest(name: Option[String])
final case class CsvPreviewResponse(headers: Vector[String], rows: Vector[Vector[String]])
final case class PreviewSourceResponse(
    rows: Vector[JsValue],
    evaluationErrors: Vector[String] = Vector.empty
)

// ── Typed config payloads (wire <-> domain mirrors) ──────────────────────────

final case class CsvSourceConfigPayload(path: String)

final case class SqlSourceConfigPayload(
    dialect: String,
    host: String,
    port: Int,
    database: String,
    user: String,
    password: String,
    query: String
)

final case class RestApiAuthPayload(
    `type`: String,
    token: Option[String],
    name: Option[String],
    value: Option[String],
    in: Option[String]
)
final case class RestApiConfigPayload(
    url: String,
    method: Option[String],
    auth: Option[RestApiAuthPayload],
    headers: Option[Map[String, String]]
)

final case class TextSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class TextSourceUrlConfigPayload(url: String)
final case class TextSourceUrlRequest(name: String, `type`: String, config: TextSourceUrlConfigPayload)

final case class PdfSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class PdfSourceUrlConfigPayload(url: String)
final case class PdfSourceUrlRequest(name: String, `type`: String, config: PdfSourceUrlConfigPayload)

final case class ImageSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class ImageSourceUrlConfigPayload(url: String)
final case class ImageSourceUrlRequest(name: String, `type`: String, config: ImageSourceUrlConfigPayload)

final case class FieldOverridePayload(name: String, displayName: String, dataType: String)
final case class CreateSourceRequest(
    name: String,
    `type`: String,
    config: RestApiConfigPayload,
    fieldOverrides: Option[Vector[FieldOverridePayload]]
)
final case class CreateSourceResponse(
    source: DataSourceResponse,
    dataType: Option[DataTypeResponse],
    fetchError: Option[String]
)

final case class SqlCreateSourceRequest(name: String, `type`: String, config: SqlSourceConfigPayload)
final case class SqlInferRequest(`type`: String, config: SqlSourceConfigPayload)

// ── Static connector API types ───────────────────────────────────────────────

final case class StaticColumnPayload(name: String, `type`: String)
final case class StaticDataPayload(columns: Vector[StaticColumnPayload], rows: Vector[Vector[JsValue]])
final case class StaticDataSourceRequest(
    name: String,
    `type`: String,
    columns: Vector[StaticColumnPayload],
    rows: Vector[Vector[JsValue]]
)

object DataSourceResponse {
  /** Project the domain ADT into the discriminated-union wire response.
   *
   *  **Credential redaction**: REST auth tokens and SQL passwords are stripped
   *  before serialization. The `rest-api-connector` and `data-source-acl`
   *  specs require that credentials never appear in API responses; the
   *  CS2c-2 wire-shape evolution preserves that invariant by zeroing the
   *  sensitive fields here. Existing pre-CS2c-2 behaviour was to omit
   *  `config` entirely — now we surface a non-credential subset (URL, method,
   *  query, dialect, etc.) which the UI needs for previews and editing. */
  def fromDomain(ds: DataSource): DataSourceResponse = ds match {
    case c: CsvSource =>
      CsvSourceResponse(
        id        = c.id.value,
        name      = c.name,
        createdAt = c.createdAt.toString,
        updatedAt = c.updatedAt.toString,
        config    = CsvSourceConfigPayload(c.config.path)
      )
    case r: RestSource =>
      RestSourceResponse(
        id        = r.id.value,
        name      = r.name,
        createdAt = r.createdAt.toString,
        updatedAt = r.updatedAt.toString,
        config    = SecretRedaction.redact(RestApiConfigPayload.fromDomain(r.config))
      )
    case s: SqlSource =>
      SqlSourceResponse(
        id        = s.id.value,
        name      = s.name,
        createdAt = s.createdAt.toString,
        updatedAt = s.updatedAt.toString,
        config    = SecretRedaction.redact(SqlSourceConfigPayload.fromDomain(s.config))
      )
    case s: StaticSource =>
      StaticSourceResponse(
        id        = s.id.value,
        name      = s.name,
        createdAt = s.createdAt.toString,
        updatedAt = s.updatedAt.toString
      )
    case t: TextSource =>
      TextSourceResponse(
        id        = t.id.value,
        name      = t.name,
        createdAt = t.createdAt.toString,
        updatedAt = t.updatedAt.toString,
        config    = TextSourceConfigPayload(t.config.path, t.config.sourceUrl)
      )
    case p: PdfSource =>
      PdfSourceResponse(
        id        = p.id.value,
        name      = p.name,
        createdAt = p.createdAt.toString,
        updatedAt = p.updatedAt.toString,
        config    = PdfSourceConfigPayload(p.config.path, p.config.sourceUrl)
      )
    case i: ImageSource =>
      ImageSourceResponse(
        id        = i.id.value,
        name      = i.name,
        createdAt = i.createdAt.toString,
        updatedAt = i.updatedAt.toString,
        config    = ImageSourceConfigPayload(i.config.path, i.config.sourceUrl)
      )
  }
}

object SqlSourceConfigPayload {
  def toDomain(p: SqlSourceConfigPayload): SqlSourceConfig =
    SqlSourceConfig(
      dialect  = p.dialect,
      host     = p.host,
      port     = p.port,
      database = p.database,
      user     = p.user,
      password = p.password,
      query    = p.query
    )

  def fromDomain(c: SqlSourceConfig): SqlSourceConfigPayload =
    SqlSourceConfigPayload(
      dialect  = c.dialect,
      host     = c.host,
      port     = c.port,
      database = c.database,
      user     = c.user,
      password = c.password,
      query    = c.query
    )

  /** Declares `password` as the one secret field on this payload — `get` returns `None` for an
   *  empty password (preserving the existing "no spurious redaction of an unset password"
   *  exemption) and `Some(value)` otherwise. */
  implicit val hasSecrets: HasSecrets[SqlSourceConfigPayload] = HasSecrets(
    Set(
      SecretField[SqlSourceConfigPayload](
        name = "password",
        get  = p => if (p.password.isEmpty) None else Some(p.password),
        set  = (p, v) => p.copy(password = v)
      )
    )
  )
}

object RestApiConfigPayload {
  def toDomain(p: RestApiConfigPayload): Either[String, RestApiConfig] = {
    val auth: Either[String, RestApiAuth] = p.auth match {
      case None => Right(RestApiAuth.NoAuth)
      case Some(a) => a.`type` match {
        case "none"    => Right(RestApiAuth.NoAuth)
        case "bearer"  =>
          a.token.toRight("bearer auth requires 'token'").map(RestApiAuth.BearerAuth(_))
        case "api_key" =>
          for {
            name  <- a.name.toRight("api_key auth requires 'name'")
            value <- a.value.toRight("api_key auth requires 'value'")
            in    <- a.in.toRight("api_key auth requires 'in' (header or query)")
            placement <- in match {
              case "header" => Right(ApiKeyPlacement.Header)
              case "query"  => Right(ApiKeyPlacement.Query)
              case other    => Left(s"Invalid 'in' value: '$other'. Must be 'header' or 'query'")
            }
          } yield RestApiAuth.ApiKeyAuth(name, value, placement)
        case other => Left(s"Unknown auth type: '$other'. Valid values: none, bearer, api_key")
      }
    }
    auth.map(a =>
      RestApiConfig(
        url     = p.url,
        method  = p.method.getOrElse("GET"),
        auth    = a,
        headers = p.headers.getOrElse(Map.empty)
      )
    )
  }

  def fromDomain(c: RestApiConfig): RestApiConfigPayload = {
    val authPayload: Option[RestApiAuthPayload] = c.auth match {
      case RestApiAuth.NoAuth                          => Some(RestApiAuthPayload("none", None, None, None, None))
      case RestApiAuth.BearerAuth(token)               => Some(RestApiAuthPayload("bearer", Some(token), None, None, None))
      case RestApiAuth.ApiKeyAuth(name, value, in) =>
        val inStr = in match {
          case ApiKeyPlacement.Header => "header"
          case ApiKeyPlacement.Query  => "query"
        }
        Some(RestApiAuthPayload("api_key", None, Some(name), Some(value), Some(inStr)))
    }
    RestApiConfigPayload(
      url     = c.url,
      method  = Some(c.method),
      auth    = authPayload,
      headers = if (c.headers.isEmpty) None else Some(c.headers)
    )
  }

  /** Declares the two credential-bearing fields on this payload — the bearer `auth.token` and the
   *  api-key `auth.value` — each gated on `auth` being present *and* its `type` discriminator
   *  matching (only one kind of auth is ever active on a given config, matching the existing
   *  `case "bearer" =>` / `case "api_key" =>` split). Both fields mask whenever `Some(_)`, empty
   *  string or not — unlike SQL's password, REST auth has no emptiness exemption. */
  implicit val hasSecrets: HasSecrets[RestApiConfigPayload] = HasSecrets(
    Set(
      SecretField[RestApiConfigPayload](
        name = "auth.token",
        get  = p => p.auth.filter(_.`type` == "bearer").flatMap(_.token),
        set  = (p, v) => p.copy(auth = p.auth.map(_.copy(token = Some(v))))
      ),
      SecretField[RestApiConfigPayload](
        name = "auth.value",
        get  = p => p.auth.filter(_.`type` == "api_key").flatMap(_.value),
        set  = (p, v) => p.copy(auth = p.auth.map(_.copy(value = Some(v))))
      )
    )
  )
}

// `DataSourceConfigCodec` lives in `DataSourceConfigCodec.scala` — used by
// the repository to encode/decode the stored config JSON blob.

/** `DataSourceProtocol extends DataTypeProtocol` because
 *  `CreateSourceResponse` carries a `DataTypeResponse`, so
 *  `createSourceResponseFormat`'s macro needs `dataTypeResponseFormat`
 *  in implicit scope. Passive structural dependency. */
trait DataSourceProtocol extends SprayJsonSupport with DefaultJsonProtocol with DataTypeProtocol {

  // ── Connector config payload formats ─────────────────────────────────────
  implicit val csvSourceConfigPayloadFormat: RootJsonFormat[CsvSourceConfigPayload]   = jsonFormat1(CsvSourceConfigPayload.apply)
  implicit val sqlSourceConfigPayloadFormat: RootJsonFormat[SqlSourceConfigPayload]   = jsonFormat7(SqlSourceConfigPayload.apply)
  implicit val restApiAuthPayloadFormat: RootJsonFormat[RestApiAuthPayload]           = jsonFormat5(RestApiAuthPayload.apply)
  implicit val restApiConfigPayloadFormat: RootJsonFormat[RestApiConfigPayload]       = jsonFormat4(RestApiConfigPayload.apply)
  implicit val fieldOverridePayloadFormat: RootJsonFormat[FieldOverridePayload]       = jsonFormat3(FieldOverridePayload.apply)
  implicit val textSourceConfigPayloadFormat: RootJsonFormat[TextSourceConfigPayload]       = jsonFormat2(TextSourceConfigPayload.apply)
  implicit val textSourceUrlConfigPayloadFormat: RootJsonFormat[TextSourceUrlConfigPayload] = jsonFormat1(TextSourceUrlConfigPayload.apply)
  implicit val textSourceUrlRequestFormat: RootJsonFormat[TextSourceUrlRequest]             = jsonFormat3(TextSourceUrlRequest.apply)
  implicit val pdfSourceConfigPayloadFormat: RootJsonFormat[PdfSourceConfigPayload]         = jsonFormat2(PdfSourceConfigPayload.apply)
  implicit val pdfSourceUrlConfigPayloadFormat: RootJsonFormat[PdfSourceUrlConfigPayload]   = jsonFormat1(PdfSourceUrlConfigPayload.apply)
  implicit val pdfSourceUrlRequestFormat: RootJsonFormat[PdfSourceUrlRequest]               = jsonFormat3(PdfSourceUrlRequest.apply)
  implicit val imageSourceConfigPayloadFormat: RootJsonFormat[ImageSourceConfigPayload]       = jsonFormat2(ImageSourceConfigPayload.apply)
  implicit val imageSourceUrlConfigPayloadFormat: RootJsonFormat[ImageSourceUrlConfigPayload] = jsonFormat1(ImageSourceUrlConfigPayload.apply)
  implicit val imageSourceUrlRequestFormat: RootJsonFormat[ImageSourceUrlRequest]             = jsonFormat3(ImageSourceUrlRequest.apply)

  // ── Per-subtype response formats (used only inside DataSourceResponseFormat) ─
  private val csvSourceResponseFormat: RootJsonFormat[CsvSourceResponse]       = jsonFormat5(CsvSourceResponse.apply)
  private val restSourceResponseFormat: RootJsonFormat[RestSourceResponse]     = jsonFormat5(RestSourceResponse.apply)
  private val sqlSourceResponseFormat: RootJsonFormat[SqlSourceResponse]       = jsonFormat5(SqlSourceResponse.apply)
  private val staticSourceResponseFormat: RootJsonFormat[StaticSourceResponse] = jsonFormat4(StaticSourceResponse.apply)
  private val textSourceResponseFormat: RootJsonFormat[TextSourceResponse]     = jsonFormat5(TextSourceResponse.apply)
  private val pdfSourceResponseFormat: RootJsonFormat[PdfSourceResponse]       = jsonFormat5(PdfSourceResponse.apply)
  private val imageSourceResponseFormat: RootJsonFormat[ImageSourceResponse]   = jsonFormat5(ImageSourceResponse.apply)

  /** Discriminated-union format for the [[DataSourceResponse]] ADT.
   *
   *  Each subtype's serialized form starts with `"type": "<kind>"` plus the
   *  common identity / timestamp fields, followed by the typed `config`
   *  payload (omitted for `static`). Inbound deserialization is the inverse
   *  of the write side and dispatches on the `type` field. */
  implicit object dataSourceResponseFormat extends RootJsonFormat[DataSourceResponse] {
    override def write(d: DataSourceResponse): JsValue = {
      val inner = d match {
        case c: CsvSourceResponse    => csvSourceResponseFormat.write(c).asJsObject
        case r: RestSourceResponse   => restSourceResponseFormat.write(r).asJsObject
        case s: SqlSourceResponse    => sqlSourceResponseFormat.write(s).asJsObject
        case s: StaticSourceResponse => staticSourceResponseFormat.write(s).asJsObject
        case t: TextSourceResponse   => textSourceResponseFormat.write(t).asJsObject
        case p: PdfSourceResponse    => pdfSourceResponseFormat.write(p).asJsObject
        case i: ImageSourceResponse  => imageSourceResponseFormat.write(i).asJsObject
      }
      JsObject(inner.fields + ("type" -> JsString(d.`type`)))
    }

    override def read(json: JsValue): DataSourceResponse = json.asJsObject.fields.get("type") match {
      case Some(JsString(DataSourceKind.Csv))     => csvSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.RestApi)) => restSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.Sql))     => sqlSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.Static))  => staticSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.Text))    => textSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.Pdf))     => pdfSourceResponseFormat.read(json)
      case Some(JsString(DataSourceKind.Image))   => imageSourceResponseFormat.read(json)
      case Some(other)                            => deserializationError(s"Unknown DataSource type: $other")
      case None                                   => deserializationError("Missing 'type' discriminator on DataSource")
    }
  }

  implicit val dataSourcesResponseFormat: RootJsonFormat[DataSourcesResponse]         = jsonFormat1(DataSourcesResponse.apply)
  implicit val updateDataSourceRequestFormat: RootJsonFormat[UpdateDataSourceRequest] = jsonFormat1(UpdateDataSourceRequest.apply)
  implicit val csvPreviewResponseFormat: RootJsonFormat[CsvPreviewResponse]           = jsonFormat2(CsvPreviewResponse.apply)
  implicit val previewSourceResponseFormat: RootJsonFormat[PreviewSourceResponse]     = jsonFormat2(PreviewSourceResponse.apply)

  // SQL connector formats
  implicit val sqlCreateSourceRequestFormat: RootJsonFormat[SqlCreateSourceRequest] = jsonFormat3(SqlCreateSourceRequest.apply)
  implicit val sqlInferRequestFormat: RootJsonFormat[SqlInferRequest]               = jsonFormat2(SqlInferRequest.apply)

  // REST connector formats
  implicit val createSourceRequestFormat: RootJsonFormat[CreateSourceRequest]   = jsonFormat4(CreateSourceRequest.apply)
  implicit val createSourceResponseFormat: RootJsonFormat[CreateSourceResponse] = jsonFormat3(CreateSourceResponse.apply)

  // Static connector formats
  implicit val staticColumnPayloadFormat: RootJsonFormat[StaticColumnPayload]         = jsonFormat2(StaticColumnPayload.apply)
  implicit val staticDataPayloadFormat: RootJsonFormat[StaticDataPayload]             = jsonFormat2(StaticDataPayload.apply)
  implicit val staticDataSourceRequestFormat: RootJsonFormat[StaticDataSourceRequest] = jsonFormat4(StaticDataSourceRequest.apply)
}
