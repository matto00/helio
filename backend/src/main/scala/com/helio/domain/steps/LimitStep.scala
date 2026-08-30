package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `limit` step. */
final case class LimitConfig(count: Int)

object LimitConfig {
  implicit val format: RootJsonFormat[LimitConfig] = jsonFormat1(LimitConfig.apply)

  def decode(raw: String): LimitConfig = {
    val obj = StepCodecUtil.asObject(raw)
    // HEL-814: two distinct failures used to collapse into the same `0`.
    // A wrong-TYPE `count` (a string, an array) now raises here (D1). A
    // correctly-typed but non-representable number still yields `0` here so
    // the stored row keeps listing, and is rejected at analyze and run (D4)
    // where the raw config is still available — `0` MEANS UNLIMITED, so
    // narrowing to it silently WIDENS the result set.
    LimitConfig(StepCodecUtil.int(obj, "count", 0))
  }
}

/** Limit step — keeps the first `count` rows. `count <= 0` is a no-op
 *  (returns the input rows unchanged); this matches the pre-CS2c-3a engine
 *  behaviour for legacy rows persisted with the default `count = 0`. */
final case class LimitStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: LimitConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = LimitStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(LimitStep.apply(rows, config))
}

object LimitStep {
  val Kind: String = "limit"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: LimitConfig): Seq[PipelineRowJson.Row] = {
    val count = cfg.count
    if (count <= 0) rows else rows.take(count)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = LimitConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[LimitConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[LimitConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[LimitConfig].toJson

    /** HEL-814 D4, and ONLY the narrow half of it.
     *
     *  A missing, zero or negative `count` is explicitly blessed by
     *  `pipeline-limit-op:9` and its named scenario "Count is zero or
     *  negative" as a safe no-op returning all rows, so it is untouched.
     *  What IS rejected is a correctly-typed number that cannot be
     *  represented as `Int`: `decode` narrows it to `0`, and `0` MEANS
     *  UNLIMITED, so the narrowing silently WIDENS the result set. A
     *  wrong-TYPE `count` never reaches here — D1 raises for it at decode.
     *
     *  **KNOWN SURFACE BOUNDARY — this one is ANALYZE-only, and deliberately.**
     *  Every other value in this declaration survives the typed round trip
     *  (D4/5.1b exists precisely so enums are preserved verbatim rather than
     *  coerced), so run and analyze evaluate identical text. `count` is the
     *  single exception: `decode` must narrow it to an `Int` to build
     *  `LimitConfig`, so by the time the RUN path re-encodes the typed config
     *  the original number is already gone and this predicate sees
     *  `{"count":0}`. Closing that would require one of three things this
     *  ticket's settled design rules out — raising at decode (a stored row
     *  would then 500 on listing, over a population the 233-row measurement
     *  never covered, which is exactly the risk D4 refused to take for
     *  enums), changing `LimitConfig`'s wire shape to carry the unnarrowed
     *  value, or threading the stored raw config through the engine.
     *
     *  The shipped requirement asks for analyze and only analyze here
     *  (`pipeline-step-config-validation`, scenario "A non-representable
     *  limit count is reported rather than narrowed": "**WHEN** the pipeline
     *  is analyzed"), so this satisfies it. The residual gap is that a
     *  non-representable `count` reaching a run WITHOUT being analyzed still
     *  behaves as unlimited. Stated here rather than left implicit. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      scala.util.Try(StepCodecUtil.asObject(raw)).toOption.flatMap(_.fields.get("count")) match {
        case Some(JsNumber(n)) if scala.util.Try(n.toIntExact).isFailure =>
          Vector(s"$Kind step 'count' is not representable as a 32-bit integer: $n.")
        case _ => Vector.empty
      }
  }
}
