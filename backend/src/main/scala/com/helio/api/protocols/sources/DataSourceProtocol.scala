package com.helio.api.protocols.sources

import com.helio.api.protocols.pipelines.{DataTypeProtocol, DataTypeResponse}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import com.helio.services.auth.{HasSecrets, SecretField, SecretRedaction}
import spray.json._

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
  /** HEL-366: optional free-form grouping tag, set only at create time. */
  def tag: Option[String]
}

final case class CsvSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: CsvSourceConfigPayload,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Csv
}

final case class RestSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: RestApiConfigPayload,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.RestApi
}

final case class SqlSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: SqlSourceConfigPayload,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Sql
}

final case class StaticSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Static
}

final case class TextSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: TextSourceConfigPayload,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Text
}

final case class PdfSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: PdfSourceConfigPayload,
    tag: Option[String] = None
) extends DataSourceResponse {
  def `type`: String = DataSourceKind.Pdf
}

final case class ImageSourceResponse(
    id: String,
    name: String,
    createdAt: String,
    updatedAt: String,
    config: ImageSourceConfigPayload,
    tag: Option[String] = None
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

/** HEL-822: wire shape carries BOTH halves of design.md Decision 1's dual-support —
 *  `connectorId` (the new path) OR `url` (the legacy bare-URL path), as sibling `Option`
 *  fields; exactly one must be present (`RestApiConfigPayload.toDomain` enforces this).
 *  `auth` is retained here ONLY so a request that still carries it can be detected and
 *  rejected (400) — it is never populated by `fromDomain`/never round-tripped into a
 *  response; auth material lives entirely on the referenced Connector now. */
final case class RestApiConfigPayload(
    connectorId: Option[String] = None,
    url: Option[String] = None,
    endpoint: Option[String] = None,
    method: Option[String] = None,
    queryParams: Option[Map[String, String]] = None,
    headers: Option[Map[String, String]] = None,
    body: Option[String] = None,
    bodyContentType: Option[String] = None,
    rootSelector: Option[String] = None,
    auth: Option[JsValue] = None,
    // HEL-823: `Option[Map[String,String]] = None`, NOT a bare `Map` with a Scala default —
    // spray-json 1.3.6 never consults case-class defaults, only `Option` tolerates a missing
    // field (design.md Decision 2a). Every pre-existing stored config blob lacks this key.
    // NOT secret storage — round-trips unredacted on every read (`hasSecrets` below declares no
    // secret fields); never put a credential here, it belongs on the Connector.
    parameters: Option[Map[String, String]] = None
)

final case class TextSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class TextSourceUrlConfigPayload(url: String)
final case class TextSourceUrlRequest(name: String, `type`: String, config: TextSourceUrlConfigPayload, tag: Option[String] = None)

final case class PdfSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class PdfSourceUrlConfigPayload(url: String)
final case class PdfSourceUrlRequest(name: String, `type`: String, config: PdfSourceUrlConfigPayload, tag: Option[String] = None)

final case class ImageSourceConfigPayload(path: String, sourceUrl: Option[String])
final case class ImageSourceUrlConfigPayload(url: String)
final case class ImageSourceUrlRequest(name: String, `type`: String, config: ImageSourceUrlConfigPayload, tag: Option[String] = None)

final case class FieldOverridePayload(name: String, displayName: String, dataType: String)
final case class CreateSourceRequest(
    name: String,
    `type`: String,
    config: RestApiConfigPayload,
    fieldOverrides: Option[Vector[FieldOverridePayload]]
)
/** `rowCapNotice` (HEL-861, design D6): a forward-looking advisory -- populated when the
 *  connector's inference measured a true row total AND that total exceeds
 *  `InProcessPipelineEngine.MaxRunRows` -- that a run over this source will be truncated. Not a
 *  report that creation itself applied a cap (it does not; create-time caps are much smaller and
 *  distinct). `None` when the total is unknown (SQL) or under the cap. */
final case class CreateSourceResponse(
    source: DataSourceResponse,
    dataType: Option[DataTypeResponse],
    fetchError: Option[String],
    rowCapNotice: Option[String] = None
)

final case class SqlCreateSourceRequest(name: String, `type`: String, config: SqlSourceConfigPayload)
final case class SqlInferRequest(`type`: String, config: SqlSourceConfigPayload)

/** Response body for `POST /api/sources/test` (HEL-480). `error` is `None` on success and omitted
 *  from the wire entirely by spray-json (not `null`) — callers must not assume the key is always
 *  present. Carries no field derived from the request's `config` beyond this curated message. */
final case class TestConnectionResponse(ok: Boolean, error: Option[String])


final case class StaticColumnPayload(name: String, `type`: String)
final case class StaticDataPayload(columns: Vector[StaticColumnPayload], rows: Vector[Vector[JsValue]])
final case class StaticDataSourceRequest(
    name: String,
    `type`: String,
    columns: Vector[StaticColumnPayload],
    rows: Vector[Vector[JsValue]],
    tag: Option[String] = None
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
        config    = CsvSourceConfigPayload(c.config.path),
        tag       = c.tag
      )
    case r: RestSource =>
      RestSourceResponse(
        id        = r.id.value,
        name      = r.name,
        createdAt = r.createdAt.toString,
        updatedAt = r.updatedAt.toString,
        config    = SecretRedaction.redact(RestApiConfigPayload.fromDomain(r.config)),
        tag       = r.tag
      )
    case s: SqlSource =>
      SqlSourceResponse(
        id        = s.id.value,
        name      = s.name,
        createdAt = s.createdAt.toString,
        updatedAt = s.updatedAt.toString,
        config    = SecretRedaction.redact(SqlSourceConfigPayload.fromDomain(s.config)),
        tag       = s.tag
      )
    case s: StaticSource =>
      StaticSourceResponse(
        id        = s.id.value,
        name      = s.name,
        createdAt = s.createdAt.toString,
        updatedAt = s.updatedAt.toString,
        tag       = s.tag
      )
    case t: TextSource =>
      TextSourceResponse(
        id        = t.id.value,
        name      = t.name,
        createdAt = t.createdAt.toString,
        updatedAt = t.updatedAt.toString,
        config    = TextSourceConfigPayload(t.config.path, t.config.sourceUrl),
        tag       = t.tag
      )
    case p: PdfSource =>
      PdfSourceResponse(
        id        = p.id.value,
        name      = p.name,
        createdAt = p.createdAt.toString,
        updatedAt = p.updatedAt.toString,
        config    = PdfSourceConfigPayload(p.config.path, p.config.sourceUrl),
        tag       = p.tag
      )
    case i: ImageSource =>
      ImageSourceResponse(
        id        = i.id.value,
        name      = i.name,
        createdAt = i.createdAt.toString,
        updatedAt = i.updatedAt.toString,
        config    = ImageSourceConfigPayload(i.config.path, i.config.sourceUrl),
        tag       = i.tag
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

  /** Reserved `connectorId` values that can never arise from client input at this decode
   *  boundary (design.md Decision 1c revised, round-3 CR2/CR3 — task 2a.2a): the sentinels
   *  `DataSourceRepository.rowToDomain` synthesizes for an undecoded/malformed stored row.
   *  Rejecting them here closes the bypass structurally, not by convention. */
  val ReservedConnectorIds: Set[String] = Set("__unmigrated__", "__malformed__")

  /** Create/update path only (design.md Decision 1c revised — NOT used for `infer`/`test`,
   *  which resolve a bare `url` ephemerally instead, never through this method). Enforces:
   *  - a request carrying an `auth` field is rejected (400) — auth lives on the Connector now.
   *  - exactly one of `connectorId`/`url` must be present (the ambiguity guard, design.md
   *    Decision 1 revised).
   *  - a present `connectorId` is structurally validated (non-empty, not a reserved sentinel)
   *    before it ever reaches `findByIdOwned`.
   *
   *  A bare `url` (no `connectorId`) is intentionally NOT resolved here — this method has no
   *  repository/user access to synthesize the implicit Connector design.md Decision 1
   *  describes; callers needing that dual-support (`SourceService.createRest`,
   *  `PipelineService.resolveInlineSourceSchema`) branch on `p.url` themselves before ever
   *  reaching this method's `connectorId`-only success path. */
  def toDomain(p: RestApiConfigPayload): Either[String, RestApiConfig] =
    if (p.auth.isDefined)
      Left("auth is not accepted on a REST source — auth lives on the referenced Connector")
    else
      (p.connectorId, p.url) match {
        case (Some(_), Some(_)) => Left("provide exactly one of connectorId or url")
        case (None, None)       => Left("Missing required fields: connectorId or url")
        case (None, Some(_))    => Left("legacy-url: caller must resolve the implicit Connector")
        case (Some(cidRaw), None) =>
          val cid = cidRaw.trim
          if (cid.isEmpty || ReservedConnectorIds.contains(cid))
            Left("Connector not found")
          else
            Right(
              RestApiConfig(
                connectorId = cid,
                endpoint    = p.endpoint.getOrElse(""),
                method      = p.method.getOrElse("GET"),
                queryParams     = p.queryParams.getOrElse(Map.empty),
                headers         = p.headers.getOrElse(Map.empty),
                body            = p.body,
                bodyContentType = p.bodyContentType,
                rootSelector    = p.rootSelector,
                parameters      = p.parameters.getOrElse(Map.empty)
              )
            )
      }

  def fromDomain(c: RestApiConfig): RestApiConfigPayload =
    RestApiConfigPayload(
      connectorId     = Some(c.connectorId),
      url             = None,
      endpoint        = if (c.endpoint.isEmpty) None else Some(c.endpoint),
      method          = Some(c.method),
      queryParams     = if (c.queryParams.isEmpty) None else Some(c.queryParams),
      headers         = if (c.headers.isEmpty) None else Some(c.headers),
      body            = c.body,
      bodyContentType = c.bodyContentType,
      rootSelector    = c.rootSelector,
      auth            = None,
      parameters      = if (c.parameters.isEmpty) None else Some(c.parameters)
    )

  /** No secret fields remain on this payload (HEL-822 task 1.5) — auth/credential material
   *  lives entirely on the referenced Connector, resolved separately via
   *  `ConnectorCredentialRepository.decryptForUse`, never echoed on a `DataSource` response.
   *  Kept (empty) rather than removed so `DataSourceResponse.fromDomain`'s
   *  `SecretRedaction.redact` call keeps compiling unchanged — a `HasSecrets[Config]` instance
   *  must exist in implicit scope for any redacted config type. */
  implicit val hasSecrets: HasSecrets[RestApiConfigPayload] = HasSecrets(Set.empty)
}

// `DataSourceConfigCodec` lives in `DataSourceConfigCodec.scala` — used by
// the repository to encode/decode the stored config JSON blob.

/** `DataSourceProtocol extends DataTypeProtocol` because
 *  `CreateSourceResponse` carries a `DataTypeResponse`, so
 *  `createSourceResponseFormat`'s macro needs `dataTypeResponseFormat`
 *  in implicit scope. Passive structural dependency. */
trait DataSourceProtocol extends SprayJsonSupport with DefaultJsonProtocol with DataTypeProtocol {

  implicit val csvSourceConfigPayloadFormat: RootJsonFormat[CsvSourceConfigPayload]   = jsonFormat1(CsvSourceConfigPayload.apply)
  implicit val sqlSourceConfigPayloadFormat: RootJsonFormat[SqlSourceConfigPayload]   = jsonFormat7(SqlSourceConfigPayload.apply)
  implicit val restApiAuthPayloadFormat: RootJsonFormat[RestApiAuthPayload]           = jsonFormat5(RestApiAuthPayload.apply)
  implicit val restApiConfigPayloadFormat: RootJsonFormat[RestApiConfigPayload]       = jsonFormat11(RestApiConfigPayload.apply)
  implicit val fieldOverridePayloadFormat: RootJsonFormat[FieldOverridePayload]       = jsonFormat3(FieldOverridePayload.apply)
  implicit val textSourceConfigPayloadFormat: RootJsonFormat[TextSourceConfigPayload]       = jsonFormat2(TextSourceConfigPayload.apply)
  implicit val textSourceUrlConfigPayloadFormat: RootJsonFormat[TextSourceUrlConfigPayload] = jsonFormat1(TextSourceUrlConfigPayload.apply)
  implicit val textSourceUrlRequestFormat: RootJsonFormat[TextSourceUrlRequest]             = jsonFormat4(TextSourceUrlRequest.apply)
  implicit val pdfSourceConfigPayloadFormat: RootJsonFormat[PdfSourceConfigPayload]         = jsonFormat2(PdfSourceConfigPayload.apply)
  implicit val pdfSourceUrlConfigPayloadFormat: RootJsonFormat[PdfSourceUrlConfigPayload]   = jsonFormat1(PdfSourceUrlConfigPayload.apply)
  implicit val pdfSourceUrlRequestFormat: RootJsonFormat[PdfSourceUrlRequest]               = jsonFormat4(PdfSourceUrlRequest.apply)
  implicit val imageSourceConfigPayloadFormat: RootJsonFormat[ImageSourceConfigPayload]       = jsonFormat2(ImageSourceConfigPayload.apply)
  implicit val imageSourceUrlConfigPayloadFormat: RootJsonFormat[ImageSourceUrlConfigPayload] = jsonFormat1(ImageSourceUrlConfigPayload.apply)
  implicit val imageSourceUrlRequestFormat: RootJsonFormat[ImageSourceUrlRequest]             = jsonFormat4(ImageSourceUrlRequest.apply)

  // ── Per-subtype response formats (used only inside DataSourceResponseFormat) ─
  private val csvSourceResponseFormat: RootJsonFormat[CsvSourceResponse]       = jsonFormat6(CsvSourceResponse.apply)
  private val restSourceResponseFormat: RootJsonFormat[RestSourceResponse]     = jsonFormat6(RestSourceResponse.apply)
  private val sqlSourceResponseFormat: RootJsonFormat[SqlSourceResponse]       = jsonFormat6(SqlSourceResponse.apply)
  private val staticSourceResponseFormat: RootJsonFormat[StaticSourceResponse] = jsonFormat5(StaticSourceResponse.apply)
  private val textSourceResponseFormat: RootJsonFormat[TextSourceResponse]     = jsonFormat6(TextSourceResponse.apply)
  private val pdfSourceResponseFormat: RootJsonFormat[PdfSourceResponse]       = jsonFormat6(PdfSourceResponse.apply)
  private val imageSourceResponseFormat: RootJsonFormat[ImageSourceResponse]   = jsonFormat6(ImageSourceResponse.apply)

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

  implicit val sqlCreateSourceRequestFormat: RootJsonFormat[SqlCreateSourceRequest] = jsonFormat3(SqlCreateSourceRequest.apply)
  implicit val sqlInferRequestFormat: RootJsonFormat[SqlInferRequest]               = jsonFormat2(SqlInferRequest.apply)
  implicit val testConnectionResponseFormat: RootJsonFormat[TestConnectionResponse] = jsonFormat2(TestConnectionResponse.apply)

  implicit val createSourceRequestFormat: RootJsonFormat[CreateSourceRequest]   = jsonFormat4(CreateSourceRequest.apply)
  implicit val createSourceResponseFormat: RootJsonFormat[CreateSourceResponse] = jsonFormat4(CreateSourceResponse.apply)

  implicit val staticColumnPayloadFormat: RootJsonFormat[StaticColumnPayload]         = jsonFormat2(StaticColumnPayload.apply)
  implicit val staticDataPayloadFormat: RootJsonFormat[StaticDataPayload]             = jsonFormat2(StaticDataPayload.apply)
  implicit val staticDataSourceRequestFormat: RootJsonFormat[StaticDataSourceRequest] = jsonFormat5(StaticDataSourceRequest.apply)
}
