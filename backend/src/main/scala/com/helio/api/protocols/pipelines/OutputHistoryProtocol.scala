package com.helio.api.protocols.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputHistoryPoint
import com.helio.services.pipelines.{OutputHistoryResolution, OutputHistoryService, ResolvedHistoryPoint}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

import java.time.Instant

/** HEL-1273 -- wire shapes of `GET /api/outputs/:id/history` and its public variant. Named
 *  `...PointResponse` to stay apart from the repository's `OutputHistoryPoint`. */
final case class OutputHistoryPointResponse(capturedAt: Instant, runId: Option[String], triggerSource: String, rowCount: Int, summary: JsObject)
final case class SparklinePoint(capturedAt: Instant, value: Option[Double])
final case class OutputHistoryResponse(
    outputId: String,
    compare: Option[String],
    current: Option[ResolvedHistoryPoint],
    baseline: Option[ResolvedHistoryPoint],
    delta: Option[Double],
    pct: Option[Double],
    availableFrom: Option[Instant],
    sparkline: Vector[SparklinePoint],
    points: Vector[OutputHistoryPointResponse]
)

/** The PUBLIC allowlist type: a separate shape (never a filtered copy of the authenticated one) with
 *  no field that could carry a run id, trigger source, owner id or Output id. */
final case class PublicOutputHistoryPoint(capturedAt: Instant, rowCount: Int, summary: JsObject)
final case class PublicOutputHistoryResponse(
    compare: Option[String],
    current: Option[ResolvedHistoryPoint],
    baseline: Option[ResolvedHistoryPoint],
    delta: Option[Double],
    pct: Option[Double],
    availableFrom: Option[Instant],
    sparkline: Vector[SparklinePoint],
    points: Vector[PublicOutputHistoryPoint]
)

object OutputHistoryResponses {
  /** Oldest first, exactly the returned `points`. */
  private def sparkline(points: Vector[OutputHistoryPoint]): Vector[SparklinePoint] =
    points.reverse.map(p => SparklinePoint(p.capturedAt, OutputHistoryService.headline(p.summary)))

  def authenticated(outputId: String, r: OutputHistoryResolution): OutputHistoryResponse =
    OutputHistoryResponse(
      outputId, r.compare, r.current, r.baseline, r.delta, r.pct, r.availableFrom, sparkline(r.points),
      r.points.map(p => OutputHistoryPointResponse(p.capturedAt, p.runId, p.triggerSource, p.rowCount, p.summary))
    )

  /** Built field by field -- never `authenticated(...)` with fields removed. */
  def public(r: OutputHistoryResolution): PublicOutputHistoryResponse =
    PublicOutputHistoryResponse(
      r.compare, r.current, r.baseline, r.delta, r.pct, r.availableFrom, sparkline(r.points),
      r.points.map(p => PublicOutputHistoryPoint(p.capturedAt, p.rowCount, p.summary))
    )
}

trait OutputHistoryProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only: every nullable field is an explicit JSON `null` (never omitted), which spray's
   *  default `jsonFormatN` would drop. Global `NullOptions` is deliberately NOT mixed in. */
  private def writeOnly[T](w: T => JsValue): RootJsonFormat[T] = new RootJsonFormat[T] {
    def write(t: T): JsValue = w(t)
    def read(json: JsValue): T = deserializationError("history responses are write-only")
  }

  private def str(v: Option[String]): JsValue    = v.fold[JsValue](JsNull)(JsString(_))
  private def inst(v: Option[Instant]): JsValue  = v.fold[JsValue](JsNull)(i => JsString(i.toString))
  private def num(v: Option[Double]): JsValue    = v.filter(d => !d.isNaN && !d.isInfinite).fold[JsValue](JsNull)(d => JsNumber(d))

  private def resolved(p: ResolvedHistoryPoint): JsValue =
    JsObject("capturedAt" -> JsString(p.capturedAt.toString), "rowCount" -> JsNumber(p.rowCount), "value" -> num(p.value))

  private def sparklinePoint(p: SparklinePoint): JsValue =
    JsObject("capturedAt" -> JsString(p.capturedAt.toString), "value" -> num(p.value))

  private def common(
      compare: Option[String], current: Option[ResolvedHistoryPoint], baseline: Option[ResolvedHistoryPoint],
      delta: Option[Double], pct: Option[Double], availableFrom: Option[Instant], sparkline: Vector[SparklinePoint]
  ): Vector[(String, JsValue)] =
    Vector(
      "compare"       -> str(compare),
      "current"       -> current.fold[JsValue](JsNull)(resolved),
      "baseline"      -> baseline.fold[JsValue](JsNull)(resolved),
      "delta"         -> num(delta),
      "pct"           -> num(pct),
      "availableFrom" -> inst(availableFrom),
      "sparkline"     -> JsArray(sparkline.map(sparklinePoint))
    )

  implicit val outputHistoryResponseFormat: RootJsonFormat[OutputHistoryResponse] = writeOnly { r =>
    val points = JsArray(r.points.map(p =>
      JsObject(
        "capturedAt"    -> JsString(p.capturedAt.toString),
        "runId"         -> str(p.runId),
        "triggerSource" -> JsString(p.triggerSource),
        "rowCount"      -> JsNumber(p.rowCount),
        "summary"       -> p.summary
      )
    ))
    JsObject(
      (("outputId" -> (JsString(r.outputId): JsValue)) +: common(r.compare, r.current, r.baseline, r.delta, r.pct, r.availableFrom, r.sparkline) :+ ("points" -> (points: JsValue))).toMap
    )
  }

  implicit val publicOutputHistoryResponseFormat: RootJsonFormat[PublicOutputHistoryResponse] = writeOnly { r =>
    val points = JsArray(r.points.map(p =>
      JsObject("capturedAt" -> JsString(p.capturedAt.toString), "rowCount" -> JsNumber(p.rowCount), "summary" -> p.summary)
    ))
    JsObject((common(r.compare, r.current, r.baseline, r.delta, r.pct, r.availableFrom, r.sparkline) :+ ("points" -> (points: JsValue))).toMap)
  }
}
