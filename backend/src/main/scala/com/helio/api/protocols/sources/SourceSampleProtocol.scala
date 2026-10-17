package com.helio.api.protocols.sources

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** HEL-1628: `GET /api/data-sources/:id/sample`. `rows` are already value-encoded (see
 *  `SampleRowJson`); `sourceRowCount` is `None` only for a truncated live read whose total is unknown. */
final case class SourceSampleResponse(
    rows: Vector[JsObject],
    capturedAt: String,
    sourceRowCount: Option[Long],
    truncated: Boolean,
    live: Boolean
)

trait SourceSampleProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only. `sourceRowCount` is emitted as an explicit `null` for `None` (the committed contract,
   *  schemas/sources/source-sample-response.schema.json, requires the key); spray's default derived format
   *  would drop it. Global `NullOptions` is deliberately not mixed in (it would change every other shape). */
  implicit val sourceSampleResponseFormat: RootJsonFormat[SourceSampleResponse] = new RootJsonFormat[SourceSampleResponse] {
    def write(r: SourceSampleResponse): JsValue = JsObject(
      "rows"           -> JsArray(r.rows),
      "capturedAt"     -> JsString(r.capturedAt),
      "sourceRowCount" -> r.sourceRowCount.fold[JsValue](JsNull)(n => JsNumber(n)),
      "truncated"      -> JsBoolean(r.truncated),
      "live"           -> JsBoolean(r.live)
    )
    def read(json: JsValue): SourceSampleResponse = deserializationError("source sample responses are write-only")
  }
}
