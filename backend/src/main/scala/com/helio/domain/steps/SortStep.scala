package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Single sort key. `direction` is `asc` (default) or `desc`. */
final case class SortKey(field: String, direction: String)

object SortKey {
  implicit val format: RootJsonFormat[SortKey] = jsonFormat2(SortKey.apply)
}

/** Typed config for the `sort` step. Multiple keys give a stable
 *  primary/secondary sort. */
final case class SortConfig(sortBy: Vector[SortKey])

object SortConfig {
  implicit val format: RootJsonFormat[SortConfig] = jsonFormat1(SortConfig.apply)

  def decode(raw: String): SortConfig = {
    val obj    = StepCodecUtil.asObject(raw)
    val sortBy = obj.fields.get("sortBy") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[SortKey]).toOption)
      case _ => Vector.empty[SortKey]
    }
    SortConfig(sortBy)
  }
}

/** Sort step — multi-key stable sort. Nulls sort last in both directions
 *  (parity with the pre-CS2c-3a engine). Numeric fields compare numerically
 *  when both sides coerce to Double; otherwise the comparison falls back to
 *  string order. */
final case class SortStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SortConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = SortStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(SortStep.apply(rows, config))
}

object SortStep {
  val Kind: String = "sort"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: SortConfig): Seq[PipelineRowJson.Row] = {
    val sortBy = cfg.sortBy
    if (sortBy.isEmpty) return rows
    sortBy.foldRight(rows) { case (keySpec, currentRows) =>
      val field     = keySpec.field
      val direction = keySpec.direction
      val desc      = direction.equalsIgnoreCase("desc")
      if (field.isEmpty) currentRows
      else
        currentRows.sortWith { (a, b) =>
          val av = Option(a.getOrElse(field, null))
          val bv = Option(b.getOrElse(field, null))
          (av, bv) match {
            case (None, _) => false
            case (_, None) => true
            case (Some(x), Some(y)) =>
              val xn = PipelineRowJson.toDouble(x)
              val yn = PipelineRowJson.toDouble(y)
              (xn, yn) match {
                case (Some(xd), Some(yd)) => if (desc) xd > yd else xd < yd
                case _ =>
                  val xs = x.toString
                  val ys = y.toString
                  if (desc) xs > ys else xs < ys
              }
          }
        }
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = SortConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[SortConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[SortConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[SortConfig].toJson
  }
}
