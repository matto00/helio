package com.helio.api.protocols.panels

import com.helio.api.protocols.sources.{DataSourceProtocol, DatasetFieldResponse, DeniedPipelineResponse}
import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import com.helio.services.panels.FormSubmitResult
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** HEL-1784: `POST /api/panels/:id/submit`'s success body. Same as `RowWriteResponse` except each row's `seq` is absent
 *  (spray-json omits a `None`) for a submitter who is not the form's owner, who is not entitled to the dataset's row
 *  ordering. Only the submit routes use it; the shared row-write response is unchanged. */
final case class FormSubmitRowResponse(id: String, seq: Option[Long], updatedAt: String)
final case class FormSubmitResponse(rows: Vector[FormSubmitRowResponse], updatedAt: String, deniedPipelines: Vector[DeniedPipelineResponse])

/** `GET /api/panels/:id/form-schema`'s body: only the declarations of the fields the form binds. */
final case class FormSchemaResponse(fields: Vector[DatasetFieldResponse])

/** HEL-1587: `GET /api/dashboards/:dashboardId/panels/:panelId/form-schema`'s body, readable behind a share link: exactly
 *  `name`, `type`, `required` per bound field. No `default` (a stored value the read-only preview does not need), no row,
 *  no data source id, no owner id. */
final case class PublicFormFieldResponse(name: String, `type`: String, required: Boolean)
final case class PublicFormSchemaResponse(fields: Vector[PublicFormFieldResponse])

object PublicFormSchemaResponse {
  def fromDomain(declarations: Vector[DatasetFieldDeclaration]): PublicFormSchemaResponse =
    PublicFormSchemaResponse(declarations.map(f => PublicFormFieldResponse(f.name, DataFieldType.asString(f.fieldType), f.required)))
}

object FormSubmitResponse {
  def fromDomain(result: FormSubmitResult): FormSubmitResponse = {
    val write = result.write
    FormSubmitResponse(
      rows            = write.rows.map(r => FormSubmitRowResponse(r.id, if (result.writerIsFormOwner) Some(r.seq) else None, r.updatedAt.toString)),
      updatedAt       = write.source.updatedAt.toString,
      deniedPipelines = write.deniedPipelines.map(DeniedPipelineResponse.fromDomain)
    )
  }
}

trait FormSubmitProtocol extends SprayJsonSupport with DefaultJsonProtocol with DataSourceProtocol {
  implicit val formSubmitRowResponseFormat: RootJsonFormat[FormSubmitRowResponse] = jsonFormat3(FormSubmitRowResponse.apply)
  implicit val formSubmitResponseFormat: RootJsonFormat[FormSubmitResponse]       = jsonFormat3(FormSubmitResponse.apply)
  implicit val publicFormFieldResponseFormat: RootJsonFormat[PublicFormFieldResponse]   = jsonFormat3(PublicFormFieldResponse.apply)
  implicit val publicFormSchemaResponseFormat: RootJsonFormat[PublicFormSchemaResponse] = jsonFormat1(PublicFormSchemaResponse.apply)
  implicit val formSchemaResponseFormat: RootJsonFormat[FormSchemaResponse]       = jsonFormat1(FormSchemaResponse.apply)
}
