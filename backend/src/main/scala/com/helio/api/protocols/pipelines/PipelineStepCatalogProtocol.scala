package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.StepGroup
import com.helio.services.pipelines.{PipelineStepCatalog, PipelineStepCatalogEntry}
import spray.json._

// `GET /api/pipeline-step-catalog` wire shape (HEL-1136, design.md Decision 3). `groups` and
// `steps` are ORDERED ARRAYS — spray-json sorts `JsObject` keys, so declared display order can
// never be expressed as object-key order, mirroring `PipelineShapeProtocol`'s own comment.

/** Wire shape for one [[StepGroup]] — `{id, label}`, in the catalog's declared display order. */
final case class StepGroupResponse(id: String, label: String)

object StepGroupResponse {
  def fromDomain(group: StepGroup): StepGroupResponse =
    StepGroupResponse(id = group.id, label = group.label)
}

/** Wire shape for one [[PipelineStepCatalogEntry]]. `group` is `Option[String]` and is ABSENT from
 *  the wire (not null) when the kind declares none — design.md Decision 4, ticket.md owner ruling
 *  2: spray-json's `optionFormat` drops a `None` field entirely rather than writing `null`. */
final case class PipelineStepCatalogEntryResponse(
    kind: String,
    label: String,
    description: String,
    group: Option[String],
    authorable: Boolean
)

object PipelineStepCatalogEntryResponse {
  def fromDomain(entry: PipelineStepCatalogEntry): PipelineStepCatalogEntryResponse =
    PipelineStepCatalogEntryResponse(
      kind        = entry.kind,
      label       = entry.label,
      description = entry.description,
      group       = entry.group.map(_.id),
      authorable  = entry.authorable
    )
}

/** `GET /api/pipeline-step-catalog` response envelope. */
final case class PipelineStepCatalogResponse(
    groups: Vector[StepGroupResponse],
    steps: Vector[PipelineStepCatalogEntryResponse]
)

object PipelineStepCatalogResponse {
  def fromDomain(catalog: PipelineStepCatalog): PipelineStepCatalogResponse =
    PipelineStepCatalogResponse(
      groups = catalog.groups.map(StepGroupResponse.fromDomain),
      steps  = catalog.steps.map(PipelineStepCatalogEntryResponse.fromDomain)
    )
}

trait PipelineStepCatalogProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val stepGroupResponseFormat: RootJsonFormat[StepGroupResponse] =
    jsonFormat2(StepGroupResponse.apply)

  // HEL-1136 design.md Decision 4: `group` must be ABSENT (not null) on the wire when a kind
  // declares none. spray-json's `DefaultJsonProtocol.optionFormat` already gives exactly that
  // behavior for a field typed `Option[String]` inside a `jsonFormatN`-generated format, so no
  // custom writer is needed here — jsonFormat5 below is sufficient and is unit-tested against
  // the real absent-field wire shape (`PipelineStepCatalogProtocolSpec`).
  implicit val pipelineStepCatalogEntryResponseFormat: RootJsonFormat[PipelineStepCatalogEntryResponse] =
    jsonFormat5(PipelineStepCatalogEntryResponse.apply)

  implicit val pipelineStepCatalogResponseFormat: RootJsonFormat[PipelineStepCatalogResponse] =
    jsonFormat2(PipelineStepCatalogResponse.apply)
}
