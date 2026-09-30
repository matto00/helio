package com.helio.api.protocols.pipelines

import com.helio.services.pipelines.ProvenanceChain
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** HEL-1206 -- authenticated provenance wire shape (`GET /api/outputs/:id/provenance`). Carries
 *  ids (`pipeline.id`, `sources[].id`) because the caller can already read the Output. */
final case class ProvenanceSourceResponse(id: String, name: String, kind: String)
final case class ProvenancePipelineResponse(id: String, name: String)
final case class ProvenanceLastRunResponse(status: String, completedAt: Option[String], rowCount: Option[Long])
final case class ProvenanceAssertionsResponse(defined: Boolean, passed: Int, failed: Int, warned: Int, rootBound: Boolean)
final case class OutputProvenanceResponse(
    outputId: String,
    pipeline: ProvenancePipelineResponse,
    sources: Vector[ProvenanceSourceResponse],
    nodePath: Vector[String],
    lastRun: Option[ProvenanceLastRunResponse],
    assertions: ProvenanceAssertionsResponse
)

/** HEL-1206 design.md D1 -- the PUBLIC allowlist type, deliberately a separate shape (never a
 *  filtered copy of [[OutputProvenanceResponse]]): it has no field that could hold an id, source
 *  config, `errorLog`, assertion `observed` value, `ownerId` or pipeline link, so the exclusion is
 *  structural. `rootBound` is omitted too (only the allowlisted counts + `defined` are public). */
final case class PublicProvenanceSourceResponse(name: String, kind: String)
final case class PublicProvenancePipelineResponse(name: String)
final case class PublicProvenanceAssertionsResponse(defined: Boolean, passed: Int, failed: Int, warned: Int)
final case class PublicOutputProvenanceResponse(
    pipeline: PublicProvenancePipelineResponse,
    sources: Vector[PublicProvenanceSourceResponse],
    nodePath: Vector[String],
    lastRun: Option[ProvenanceLastRunResponse],
    assertions: PublicProvenanceAssertionsResponse
)

object ProvenanceResponses {
  def authenticated(c: ProvenanceChain): OutputProvenanceResponse =
    OutputProvenanceResponse(
      outputId   = c.outputId,
      pipeline   = ProvenancePipelineResponse(c.pipelineId, c.pipelineName),
      sources    = c.sources.map(s => ProvenanceSourceResponse(s.dataSourceId, s.name, s.kind)),
      nodePath   = c.nodePath,
      lastRun    = c.lastRun.map(r => ProvenanceLastRunResponse(r.status, r.completedAt.map(_.toString), r.rowCount)),
      assertions = ProvenanceAssertionsResponse(c.assertions.defined, c.assertions.passed, c.assertions.failed, c.assertions.warned, c.assertions.rootBound)
    )

  /** Built field by field from the internal chain -- never `authenticated(c)` with fields removed. */
  def public(c: ProvenanceChain): PublicOutputProvenanceResponse =
    PublicOutputProvenanceResponse(
      pipeline   = PublicProvenancePipelineResponse(c.pipelineName),
      sources    = c.sources.map(s => PublicProvenanceSourceResponse(s.name, s.kind)),
      nodePath   = c.nodePath,
      lastRun    = c.lastRun.map(r => ProvenanceLastRunResponse(r.status, r.completedAt.map(_.toString), r.rowCount)),
      assertions = PublicProvenanceAssertionsResponse(c.assertions.defined, c.assertions.passed, c.assertions.failed, c.assertions.warned)
    )
}

trait ProvenanceProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only formats: `lastRun`/`completedAt`/`rowCount` are emitted as explicit JSON `null`
   *  (the contract, schemas/outputs/output-provenance.schema.json), which spray's default
   *  `jsonFormatN` omits for `None`. Global `NullOptions` is deliberately NOT mixed in -- it
   *  would change every other response shape in `JsonProtocols`. */
  private def writeOnly[T](w: T => JsValue): RootJsonFormat[T] = new RootJsonFormat[T] {
    def write(t: T): JsValue = w(t)
    def read(json: JsValue): T = deserializationError("provenance responses are write-only")
  }

  private def optNum(v: Option[Long]): JsValue = v.fold[JsValue](JsNull)(n => JsNumber(n))
  private def optStr(v: Option[String]): JsValue = v.fold[JsValue](JsNull)(JsString(_))

  private val lastRunJs: ProvenanceLastRunResponse => JsValue = r =>
    JsObject("status" -> JsString(r.status), "completedAt" -> optStr(r.completedAt), "rowCount" -> optNum(r.rowCount))

  implicit val outputProvenanceResponseFormat: RootJsonFormat[OutputProvenanceResponse] = writeOnly { r =>
    JsObject(
      "outputId" -> JsString(r.outputId),
      "pipeline" -> JsObject("id" -> JsString(r.pipeline.id), "name" -> JsString(r.pipeline.name)),
      "sources"  -> JsArray(r.sources.map(s => JsObject("id" -> JsString(s.id), "name" -> JsString(s.name), "kind" -> JsString(s.kind)))),
      "nodePath" -> JsArray(r.nodePath.map(JsString(_))),
      "lastRun"  -> r.lastRun.fold[JsValue](JsNull)(lastRunJs),
      "assertions" -> JsObject(
        "defined"   -> JsBoolean(r.assertions.defined),
        "passed"    -> JsNumber(r.assertions.passed),
        "failed"    -> JsNumber(r.assertions.failed),
        "warned"    -> JsNumber(r.assertions.warned),
        "rootBound" -> JsBoolean(r.assertions.rootBound)
      )
    )
  }

  implicit val publicOutputProvenanceResponseFormat: RootJsonFormat[PublicOutputProvenanceResponse] = writeOnly { r =>
    JsObject(
      "pipeline" -> JsObject("name" -> JsString(r.pipeline.name)),
      "sources"  -> JsArray(r.sources.map(s => JsObject("name" -> JsString(s.name), "kind" -> JsString(s.kind)))),
      "nodePath" -> JsArray(r.nodePath.map(JsString(_))),
      "lastRun"  -> r.lastRun.fold[JsValue](JsNull)(lastRunJs),
      "assertions" -> JsObject(
        "defined" -> JsBoolean(r.assertions.defined),
        "passed"  -> JsNumber(r.assertions.passed),
        "failed"  -> JsNumber(r.assertions.failed),
        "warned"  -> JsNumber(r.assertions.warned)
      )
    )
  }
}
