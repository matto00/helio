package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── DataSource API types ─────────────────────────────────────────────────────

final case class DataSourceResponse(id: String, name: String, sourceType: String, createdAt: String, updatedAt: String)
final case class DataSourcesResponse(items: Vector[DataSourceResponse])
final case class CreateDataSourceRequest(name: String)
final case class UpdateDataSourceRequest(name: Option[String])
final case class CsvPreviewResponse(headers: Vector[String], rows: Vector[Vector[String]])
final case class PreviewSourceResponse(
    rows: Vector[JsValue],
    evaluationErrors: Vector[String] = Vector.empty
)

// ── SQL connector API types ──────────────────────────────────────────────────

final case class SqlSourceConfigPayload(
    dialect: String,
    host: String,
    port: Int,
    database: String,
    user: String,
    password: String,
    query: String
)
final case class SqlCreateSourceRequest(name: String, sourceType: String, config: SqlSourceConfigPayload)
final case class SqlInferRequest(sourceType: String, config: SqlSourceConfigPayload)

// ── REST connector API types ─────────────────────────────────────────────────

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
final case class FieldOverridePayload(name: String, displayName: String, dataType: String)
final case class CreateSourceRequest(
    name: String,
    sourceType: String,
    config: RestApiConfigPayload,
    fieldOverrides: Option[Vector[FieldOverridePayload]]
)
final case class CreateSourceResponse(
    source: DataSourceResponse,
    dataType: Option[DataTypeResponse],
    fetchError: Option[String]
)

// ── Static connector API types ───────────────────────────────────────────────

final case class StaticColumnPayload(name: String, `type`: String)
final case class StaticDataPayload(columns: Vector[StaticColumnPayload], rows: Vector[Vector[JsValue]])
final case class StaticDataSourceRequest(
    name: String,
    sourceType: String,
    columns: Vector[StaticColumnPayload],
    rows: Vector[Vector[JsValue]]
)

object DataSourceResponse {
  def fromDomain(ds: DataSource): DataSourceResponse =
    DataSourceResponse(
      id         = ds.id.value,
      name       = ds.name,
      sourceType = SourceType.asString(ds.sourceType),
      createdAt  = ds.createdAt.toString,
      updatedAt  = ds.updatedAt.toString
    )
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
}

/** `DataSourceProtocol extends DataTypeProtocol` because
 *  `CreateSourceResponse` carries a `DataTypeResponse`, so
 *  `createSourceResponseFormat`'s macro needs `dataTypeResponseFormat`
 *  in implicit scope. Passive structural dependency. */
trait DataSourceProtocol extends SprayJsonSupport with DefaultJsonProtocol with DataTypeProtocol {
  implicit val sourceTypeFormat: JsonFormat[SourceType] = new JsonFormat[SourceType] {
    def write(t: SourceType): JsValue = JsString(SourceType.asString(t))
    def read(json: JsValue): SourceType = json match {
      case JsString(s) => SourceType.fromString(s).fold(deserializationError(_), identity)
      case x           => deserializationError(s"Expected string for SourceType, got $x")
    }
  }

  // DataSource API formats
  implicit val dataSourceResponseFormat: RootJsonFormat[DataSourceResponse]           = jsonFormat5(DataSourceResponse.apply)
  implicit val dataSourcesResponseFormat: RootJsonFormat[DataSourcesResponse]         = jsonFormat1(DataSourcesResponse.apply)
  implicit val createDataSourceRequestFormat: RootJsonFormat[CreateDataSourceRequest] = jsonFormat1(CreateDataSourceRequest.apply)
  implicit val updateDataSourceRequestFormat: RootJsonFormat[UpdateDataSourceRequest] = jsonFormat1(UpdateDataSourceRequest.apply)
  implicit val csvPreviewResponseFormat: RootJsonFormat[CsvPreviewResponse]           = jsonFormat2(CsvPreviewResponse.apply)
  implicit val previewSourceResponseFormat: RootJsonFormat[PreviewSourceResponse]     = jsonFormat2(PreviewSourceResponse.apply)

  // SQL connector formats
  implicit val sqlSourceConfigPayloadFormat: RootJsonFormat[SqlSourceConfigPayload] = jsonFormat7(SqlSourceConfigPayload.apply)
  implicit val sqlCreateSourceRequestFormat: RootJsonFormat[SqlCreateSourceRequest] = jsonFormat3(SqlCreateSourceRequest.apply)
  implicit val sqlInferRequestFormat: RootJsonFormat[SqlInferRequest]               = jsonFormat2(SqlInferRequest.apply)

  // REST connector formats
  implicit val restApiAuthPayloadFormat: RootJsonFormat[RestApiAuthPayload]     = jsonFormat5(RestApiAuthPayload.apply)
  implicit val restApiConfigPayloadFormat: RootJsonFormat[RestApiConfigPayload] = jsonFormat4(RestApiConfigPayload.apply)
  implicit val fieldOverridePayloadFormat: RootJsonFormat[FieldOverridePayload] = jsonFormat3(FieldOverridePayload.apply)
  implicit val createSourceRequestFormat: RootJsonFormat[CreateSourceRequest]   = jsonFormat4(CreateSourceRequest.apply)
  implicit val createSourceResponseFormat: RootJsonFormat[CreateSourceResponse] = jsonFormat3(CreateSourceResponse.apply)

  // Static connector formats
  implicit val staticColumnPayloadFormat: RootJsonFormat[StaticColumnPayload]         = jsonFormat2(StaticColumnPayload.apply)
  implicit val staticDataPayloadFormat: RootJsonFormat[StaticDataPayload]             = jsonFormat2(StaticDataPayload.apply)
  implicit val staticDataSourceRequestFormat: RootJsonFormat[StaticDataSourceRequest] = jsonFormat4(StaticDataSourceRequest.apply)
}
