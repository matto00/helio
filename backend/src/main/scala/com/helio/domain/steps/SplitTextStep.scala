package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.matching.Regex

/** Typed config for the `splittext` step (HEL-219 — first of three planned
 *  "text ops"; see design.md decision 3/4 for the reusable row-shape this
 *  establishes). `headingLevel` is only consulted when `mode == "heading"`. */
final case class SplitTextConfig(
    field: String,
    mode: String,
    headingLevel: Int = 1,
    indexField: String = "segmentIndex"
)

object SplitTextConfig {
  implicit val format: RootJsonFormat[SplitTextConfig] = jsonFormat4(SplitTextConfig.apply)

  def decode(raw: String): SplitTextConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val field        = StepCodecUtil.stringOr(obj, "field", "")
    val mode         = StepCodecUtil.stringOr(obj, "mode", "paragraph")
    val headingLevel = StepCodecUtil.intOr(obj, "headingLevel", 1)
    val indexField   = StepCodecUtil.stringOr(obj, "indexField", "segmentIndex")
    SplitTextConfig(field, mode, headingLevel, indexField)
  }
}

/** SplitText step — flatMap (many→more) transform: splits a `string-body`
 *  `field` into one output row per segment.
 *
 *  For each input row: if `field` is `null` or absent, the row is dropped
 *  (zero output rows). Otherwise the field's string value is split into
 *  segments per `mode` (see [[splitParagraphs]] / [[splitHeadings]]) and one
 *  output row is emitted per segment: every other input field passes
 *  through unchanged, `field` is replaced by the segment's text, and
 *  `indexField` is set to the segment's 0-based position — written last, so
 *  it wins any name collision with `field` or another passthrough field
 *  (same "last write wins" rule `compute` already uses for column-name
 *  collisions). This 3-part row shape — (passthrough fields) + (replaced
 *  content field) + (index field) — is the reusable pattern HEL-220/HEL-221
 *  should mirror, changing only the split function. */
final case class SplitTextStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SplitTextConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = SplitTextStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(SplitTextStep.apply(rows, config))
}

object SplitTextStep {
  val Kind: String = "splittext"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: SplitTextConfig): Seq[PipelineRowJson.Row] = {
    val field      = cfg.field
    val indexField = cfg.indexField
    val split: String => Seq[String] =
      if (cfg.mode == "heading") splitHeadings(_, cfg.headingLevel) else splitParagraphs

    rows.flatMap { row =>
      row.get(field) match {
        case None | Some(null) => Seq.empty
        case Some(value) =>
          split(value.toString).zipWithIndex.map { case (segment, idx) =>
            row + (field -> segment) + (indexField -> idx)
          }
      }
    }
  }

  /** Paragraph mode: normalize `\r\n` to `\n`, split on one-or-more blank
   *  lines, trim each segment, drop empty segments. */
  def splitParagraphs(content: String): Seq[String] =
    content
      .replace("\r\n", "\n")
      .split("\n\\s*\n+")
      .toIndexedSeq
      .map(_.trim)
      .filter(_.nonEmpty)

  /** Heading mode: split at each Markdown ATX heading line matching exactly
   *  `headingLevel` `#` characters followed by whitespace. Each segment runs
   *  from that heading line through (not including) the next heading line at
   *  the same level; content before the first matching heading is dropped —
   *  if no heading of the target level exists, zero segments are returned. */
  def splitHeadings(content: String, headingLevel: Int): Seq[String] = {
    val lines           = content.replace("\r\n", "\n").split("\n", -1).toIndexedSeq
    val headingPattern: Regex = s"^#{$headingLevel}\\s+".r
    val headingLineIdxs = lines.zipWithIndex.collect {
      case (line, idx) if headingPattern.findFirstIn(line).isDefined => idx
    }
    headingLineIdxs.indices.map { i =>
      val start = headingLineIdxs(i)
      val end   = if (i + 1 < headingLineIdxs.length) headingLineIdxs(i + 1) else lines.length
      lines.slice(start, end).mkString("\n")
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = SplitTextConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[SplitTextConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[SplitTextConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[SplitTextConfig].toJson
  }
}
