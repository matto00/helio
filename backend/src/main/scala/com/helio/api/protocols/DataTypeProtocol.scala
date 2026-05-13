package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── DataType API types ───────────────────────────────────────────────────────

final case class DataFieldResponse(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class ComputedFieldResponse(name: String, displayName: String, expression: String, dataType: String)
final case class DataTypeResponse(
    id: String,
    sourceId: Option[String],
    name: String,
    fields: Vector[DataFieldResponse],
    computedFields: Vector[ComputedFieldResponse],
    version: Int,
    createdAt: String,
    updatedAt: String
)
final case class DataTypesResponse(items: Vector[DataTypeResponse])
final case class DataFieldPayload(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class ComputedFieldPayload(name: String, displayName: String, expression: String, dataType: String)
final case class UpdateDataTypeRequest(
    name: Option[String],
    fields: Option[Vector[DataFieldPayload]],
    computedFields: Option[Vector[ComputedFieldPayload]] = None
)
final case class ValidateExpressionResponse(valid: Boolean, message: Option[String])

// ── Inferred / schema field types ────────────────────────────────────────────

final case class InferredFieldResponse(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class InferredSchemaResponse(fields: Vector[InferredFieldResponse])
final case class SchemaFieldResponse(name: String, `type`: String)

// ── DataType row snapshot ────────────────────────────────────────────────────

final case class DataTypeRowsResponse(rows: Vector[JsObject], rowCount: Int)

object DataTypeResponse {
  def fromDomain(dt: DataType): DataTypeResponse =
    DataTypeResponse(
      id             = dt.id.value,
      sourceId       = dt.sourceId.map(_.value),
      name           = dt.name,
      fields         = dt.fields.map(f => DataFieldResponse(f.name, f.displayName, f.dataType, f.nullable)),
      computedFields = dt.computedFields.map(cf => ComputedFieldResponse(cf.name, cf.displayName, cf.expression, cf.dataType)),
      version        = dt.version,
      createdAt      = dt.createdAt.toString,
      updatedAt      = dt.updatedAt.toString
    )
}

trait DataTypeProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  // Domain helpers (used when serializing DataType fields in JSON blobs)
  implicit val dataFieldFormat: RootJsonFormat[DataField]         = jsonFormat4(DataField.apply)
  implicit val computedFieldFormat: RootJsonFormat[ComputedField] = jsonFormat4(ComputedField.apply)

  // DataType API formats
  implicit val dataFieldResponseFormat: RootJsonFormat[DataFieldResponse]                   = jsonFormat4(DataFieldResponse.apply)
  implicit val computedFieldResponseFormat: RootJsonFormat[ComputedFieldResponse]           = jsonFormat4(ComputedFieldResponse.apply)
  implicit val dataTypeResponseFormat: RootJsonFormat[DataTypeResponse]                     = jsonFormat8(DataTypeResponse.apply)
  implicit val dataTypesResponseFormat: RootJsonFormat[DataTypesResponse]                   = jsonFormat1(DataTypesResponse.apply)
  implicit val dataFieldPayloadFormat: RootJsonFormat[DataFieldPayload]                     = jsonFormat4(DataFieldPayload.apply)
  implicit val computedFieldPayloadFormat: RootJsonFormat[ComputedFieldPayload]             = jsonFormat4(ComputedFieldPayload.apply)
  implicit val updateDataTypeRequestFormat: RootJsonFormat[UpdateDataTypeRequest]           = jsonFormat3(UpdateDataTypeRequest.apply)
  implicit val validateExpressionResponseFormat: RootJsonFormat[ValidateExpressionResponse] = jsonFormat2(ValidateExpressionResponse.apply)

  // Inferred / schema-field formats
  implicit val inferredFieldResponseFormat: RootJsonFormat[InferredFieldResponse]   = jsonFormat4(InferredFieldResponse.apply)
  implicit val inferredSchemaResponseFormat: RootJsonFormat[InferredSchemaResponse] = jsonFormat1(InferredSchemaResponse.apply)
  implicit val schemaFieldResponseFormat: RootJsonFormat[SchemaFieldResponse]       = jsonFormat2(SchemaFieldResponse.apply)

  // Row-snapshot
  implicit val dataTypeRowsResponseFormat: RootJsonFormat[DataTypeRowsResponse] = jsonFormat2(DataTypeRowsResponse.apply)
}
