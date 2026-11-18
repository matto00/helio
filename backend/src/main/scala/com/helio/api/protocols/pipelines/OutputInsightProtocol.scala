package com.helio.api.protocols.pipelines

import com.helio.domain.insights.{OutputInsightRecord, StoredInsightCitation}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

import java.time.Instant

/** HEL-1742: wire shapes of the three insight reads. */
final case class OutputInsightResponse(outputId: String, render: Option[OutputInsightRecord], lastAttempt: Option[OutputInsightRecord])
final case class OutputInsightHistoryResponse(outputId: String, items: Vector[OutputInsightRecord])

/** The PUBLIC allowlist type: a separate shape (never a filtered copy of the authenticated one) with
 *  no field that could carry cost, model, tokens, a run id, the input digest, the trigger, a row id,
 *  an attempt status or a cited Output id. */
final case class PublicInsightCitation(id: String, field: String, number: Option[Double], date: Option[Instant], capturedAt: Option[Instant], isPct: Boolean)
final case class PublicInsightRender(markdown: String, citations: Vector[PublicInsightCitation], renderedAt: Instant)
final case class PublicOutputInsightResponse(render: Option[PublicInsightRender])

object OutputInsightResponses {

  /** Built field by field from the allow-list; never by copying the stored record and deleting keys. */
  def public(record: Option[OutputInsightRecord]): PublicOutputInsightResponse =
    PublicOutputInsightResponse(record.flatMap { r =>
      r.markdown.map { md =>
        PublicInsightRender(
          md,
          r.citations.map(c => PublicInsightCitation(c.id, c.field, c.number, c.date, c.capturedAt, c.isPct)),
          r.createdAt
        )
      }
    })
}

trait OutputInsightProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only: nullable top-level fields are explicit JSON `null`; optional detail keys are omitted. */
  private def writeOnly[T](w: T => JsValue): RootJsonFormat[T] = new RootJsonFormat[T] {
    def write(t: T): JsValue   = w(t)
    def read(json: JsValue): T = deserializationError("insight responses are write-only")
  }

  private def optional(fields: (String, Option[JsValue])*): Vector[(String, JsValue)] =
    fields.toVector.collect { case (k, Some(v)) => k -> v }

  private def num(n: Double): Option[JsValue] = Some(n).filter(d => !d.isNaN && !d.isInfinite).map(JsNumber(_))

  private def detail(r: OutputInsightRecord): Vector[(String, JsValue)] =
    optional(
      "markdown"            -> r.markdown.map(JsString(_)),
      "runId"               -> r.runId.map(JsString(_)),
      "inputDigest"         -> r.inputDigest.map(JsString(_)),
      "model"               -> r.model.map(JsString(_)),
      "inputTokens"         -> r.inputTokens.map(JsNumber(_)),
      "outputTokens"        -> r.outputTokens.map(JsNumber(_)),
      "cacheCreationTokens" -> r.cacheCreationTokens.map(JsNumber(_)),
      "cacheReadTokens"     -> r.cacheReadTokens.map(JsNumber(_)),
      "costMicros"          -> r.costMicros.map(JsNumber(_))
    )

  private def renderJson(r: OutputInsightRecord): JsValue =
    JsObject(
      (Vector[(String, JsValue)](
        "id"        -> JsString(r.id.toString),
        "citations" -> StoredInsightCitation.toJsonArray(r.citations),
        "trigger"   -> JsString(r.trigger.wire),
        "createdAt" -> JsString(r.createdAt.toString)
      ) ++ detail(r)): _*
    )

  private def attemptJson(r: OutputInsightRecord): JsValue =
    JsObject(
      "id"        -> JsString(r.id.toString),
      "status"    -> JsString(r.status.wire),
      "trigger"   -> JsString(r.trigger.wire),
      "createdAt" -> JsString(r.createdAt.toString)
    )

  private def historyItemJson(r: OutputInsightRecord): JsValue =
    JsObject(
      (Vector[(String, JsValue)](
        "id"        -> JsString(r.id.toString),
        "status"    -> JsString(r.status.wire),
        "citations" -> StoredInsightCitation.toJsonArray(r.citations),
        "trigger"   -> JsString(r.trigger.wire),
        "createdAt" -> JsString(r.createdAt.toString)
      ) ++ detail(r)): _*
    )

  implicit val outputInsightResponseFormat: RootJsonFormat[OutputInsightResponse] = writeOnly { r =>
    JsObject(
      "outputId"    -> JsString(r.outputId),
      "render"      -> r.render.fold[JsValue](JsNull)(renderJson),
      "lastAttempt" -> r.lastAttempt.fold[JsValue](JsNull)(attemptJson)
    )
  }

  implicit val outputInsightHistoryResponseFormat: RootJsonFormat[OutputInsightHistoryResponse] = writeOnly { r =>
    JsObject("outputId" -> JsString(r.outputId), "items" -> JsArray(r.items.map(historyItemJson)))
  }

  implicit val publicOutputInsightResponseFormat: RootJsonFormat[PublicOutputInsightResponse] = writeOnly { r =>
    JsObject(
      "render" -> r.render.fold[JsValue](JsNull) { render =>
        JsObject(
          "markdown" -> JsString(render.markdown),
          "citations" -> JsArray(render.citations.map { c =>
            JsObject(
              (Vector[(String, JsValue)]("id" -> JsString(c.id), "field" -> JsString(c.field), "isPct" -> JsBoolean(c.isPct)) ++
                optional(
                  "number"     -> c.number.flatMap(num),
                  "date"       -> c.date.map(d => JsString(d.toString)),
                  "capturedAt" -> c.capturedAt.map(d => JsString(d.toString))
                )): _*
            )
          }),
          "renderedAt" -> JsString(render.renderedAt.toString)
        )
      }
    )
  }
}
