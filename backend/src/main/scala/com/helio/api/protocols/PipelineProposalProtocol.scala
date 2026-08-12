package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Pipeline proposal types (HEL-379 schema + protocol foundation) ───────────
//
// A proposal carries NO ids: it describes an (optionally new) data source, an
// ordered list of transform steps, and an output DataType contract. Nothing is
// created until a future apply path (HEL-342) consumes it. The wire shape
// matches schemas/pipeline-proposal.schema.json. Mirrors
// DashboardProposalProtocol's hand-written, absent-optional-tolerant reader.

/** `source` is one flat object carrying every inline-kind's config as an
 *  `Option`, only the relevant subset populated — the same pattern
 *  `ProposalPanel` uses for panel-type-dependent fields (design.md D1). The
 *  four per-kind config fields are Scala-side only: on the wire they all
 *  serialize through one shared `"config"` key selected by `type`, never
 *  through four separately-named keys (design.md D1/D5). */
final case class PipelineProposalSource(
    sourceId: Option[String], // existing-source branch
    `type`: Option[String], // inline branch: csv|rest_api|sql|static
    name: Option[String], // inline branch: new source's name
    csvConfig: Option[CsvSourceConfigPayload],
    restConfig: Option[RestApiConfigPayload],
    sqlConfig: Option[SqlSourceConfigPayload],
    staticConfig: Option[StaticDataPayload]
)

/** `steps` reuses `CreatePipelineStepRequest` verbatim (design.md D2) — no new
 *  step DTO. Every field here is non-`Option`: all four are required by the
 *  schema (`pipelineName`, `source`, `outputDataTypeName`, `steps`). */
final case class PipelineProposal(
    pipelineName: String,
    source: PipelineProposalSource,
    outputDataTypeName: String,
    steps: Vector[CreatePipelineStepRequest]
)

trait PipelineProposalProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DataSourceProtocol
    with PipelineStepProtocol {

  /** Hand-written (not `jsonFormatN`) so the writer can pick whichever of the
   *  four per-kind `Option` fields is populated and serialize *that one* to
   *  the single `"config"` key, and the reader can dispatch on `type` to
   *  decode `"config"` into the matching field, leaving the other three
   *  `None` (design.md D1). No field here is required — an existing-source
   *  proposal supplies only `sourceId`; an inline-source proposal supplies
   *  `type`/`name`/`config` and omits `sourceId`. */
  implicit val pipelineProposalSourceFormat: RootJsonFormat[PipelineProposalSource] =
    new RootJsonFormat[PipelineProposalSource] {
      def write(s: PipelineProposalSource): JsValue = {
        val fields = scala.collection.mutable.Map[String, JsValue]()
        s.sourceId.foreach(v => fields("sourceId") = JsString(v))
        s.`type`.foreach(v => fields("type") = JsString(v))
        s.name.foreach(v => fields("name") = JsString(v))
        s.csvConfig.foreach(v => fields("config") = v.toJson)
        s.restConfig.foreach(v => fields("config") = v.toJson)
        s.sqlConfig.foreach(v => fields("config") = v.toJson)
        s.staticConfig.foreach(v => fields("config") = v.toJson)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): PipelineProposalSource = {
        val obj    = json.asJsObject
        val kind   = obj.fields.get("type").map(_.convertTo[String])
        val config = obj.fields.get("config")

        val (csvConfig, restConfig, sqlConfig, staticConfig) = kind match {
          case Some("csv")      => (config.map(_.convertTo[CsvSourceConfigPayload]), None, None, None)
          case Some("rest_api") => (None, config.map(_.convertTo[RestApiConfigPayload]), None, None)
          case Some("sql")      => (None, None, config.map(_.convertTo[SqlSourceConfigPayload]), None)
          case Some("static")   => (None, None, None, config.map(_.convertTo[StaticDataPayload]))
          case _                => (None, None, None, None)
        }

        PipelineProposalSource(
          sourceId     = obj.fields.get("sourceId").map(_.convertTo[String]),
          `type`       = kind,
          name         = obj.fields.get("name").map(_.convertTo[String]),
          csvConfig    = csvConfig,
          restConfig   = restConfig,
          sqlConfig    = sqlConfig,
          staticConfig = staticConfig
        )
      }
    }

  /** `pipelineName`/`source`/`outputDataTypeName`/`steps` are all required
   *  (none is `Option` on `PipelineProposal`) — `deserializationError` on
   *  each when absent, mirroring `proposalPanelFormat`'s treatment of
   *  `ProposalPanel`'s own two required fields (design.md D5). */
  implicit val pipelineProposalFormat: RootJsonFormat[PipelineProposal] =
    new RootJsonFormat[PipelineProposal] {
      def write(p: PipelineProposal): JsValue = JsObject(
        "pipelineName"       -> JsString(p.pipelineName),
        "source"             -> p.source.toJson,
        "outputDataTypeName" -> JsString(p.outputDataTypeName),
        "steps"              -> JsArray(p.steps.map(_.toJson))
      )

      def read(json: JsValue): PipelineProposal = {
        val obj = json.asJsObject
        PipelineProposal(
          pipelineName = obj.fields
            .get("pipelineName")
            .map(_.convertTo[String])
            .getOrElse(deserializationError("pipeline proposal 'pipelineName' is required")),
          source = obj.fields
            .get("source")
            .map(_.convertTo[PipelineProposalSource])
            .getOrElse(deserializationError("pipeline proposal 'source' is required")),
          outputDataTypeName = obj.fields
            .get("outputDataTypeName")
            .map(_.convertTo[String])
            .getOrElse(deserializationError("pipeline proposal 'outputDataTypeName' is required")),
          steps = obj.fields
            .get("steps")
            .map(_.convertTo[Vector[CreatePipelineStepRequest]])
            .getOrElse(deserializationError("pipeline proposal 'steps' is required"))
        )
      }
    }
}
