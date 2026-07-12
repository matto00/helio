package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `extractheadings` step (HEL-220 — second of three
 *  planned "text ops"; mirrors `SplitTextConfig`'s tolerant decode pattern,
 *  see design.md decision 2). `indexField` preserves `splittext`'s 3-part row
 *  shape (passthrough + replaced field + sequence index); `levelField` is the
 *  additive 4th part this op's ticket-mandated heading-level metadata
 *  requires. */
final case class ExtractHeadingsConfig(
    field: String,
    indexField: String = "headingIndex",
    levelField: String = "headingLevel"
)

object ExtractHeadingsConfig {
  implicit val format: RootJsonFormat[ExtractHeadingsConfig] = jsonFormat3(ExtractHeadingsConfig.apply)

  def decode(raw: String): ExtractHeadingsConfig = {
    val obj        = StepCodecUtil.asObject(raw)
    val field      = StepCodecUtil.stringOr(obj, "field", "")
    val indexField = StepCodecUtil.stringOr(obj, "indexField", "headingIndex")
    val levelField = StepCodecUtil.stringOr(obj, "levelField", "headingLevel")
    ExtractHeadingsConfig(field, indexField, levelField)
  }
}

/** ExtractHeadings step — flatMap (many→more) transform: scans a
 *  `string-body` `field` for Markdown ATX heading lines and emits one output
 *  row per heading found.
 *
 *  For each input row: if `field` is `null` or absent, the row is dropped
 *  (zero output rows). Otherwise the field's string value is scanned for
 *  ATX heading lines (see [[extractHeadings]]) and one output row is emitted
 *  per heading: every other input field passes through unchanged, `field` is
 *  replaced by the heading's title text, `indexField` is set to the
 *  heading's 0-based position among the headings found, and `levelField` is
 *  set to the heading's level (1-6) — both written last, so they win any
 *  name collision with `field` or another passthrough field (same
 *  "last write wins" rule `splittext`/`compute` already use). Zero heading
 *  matches yields zero output rows for that input row. */
final case class ExtractHeadingsStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ExtractHeadingsConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = ExtractHeadingsStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(ExtractHeadingsStep.apply(rows, config))
}

object ExtractHeadingsStep {
  val Kind: String = "extractheadings"

  private val HeadingPattern = "^(#{1,6})\\s+(.*)$".r

  def apply(rows: Seq[PipelineRowJson.Row], cfg: ExtractHeadingsConfig): Seq[PipelineRowJson.Row] = {
    val field      = cfg.field
    val indexField = cfg.indexField
    val levelField = cfg.levelField

    rows.flatMap { row =>
      row.get(field) match {
        case None | Some(null) => Seq.empty
        case Some(value) =>
          extractHeadings(value.toString).zipWithIndex.map { case ((title, level), idx) =>
            row + (field -> title) + (indexField -> idx) + (levelField -> level)
          }
      }
    }
  }

  /** Pure extraction function: normalize `\r\n` to `\n`, split into lines,
   *  match each line against `^(#{1,6})\s+(.*)$`, and return `(title, level)`
   *  pairs in document order. `level` is the matched `#` run's length; `title`
   *  is the second capture group trimmed. Lines inside fenced code blocks are
   *  NOT specially excluded — see design.md decision 4 for the accepted
   *  simplicity trade-off. */
  def extractHeadings(content: String): Seq[(String, Int)] =
    content
      .replace("\r\n", "\n")
      .split("\n", -1)
      .toIndexedSeq
      .collect {
        case HeadingPattern(hashes, title) => (title.trim, hashes.length)
      }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = ExtractHeadingsConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[ExtractHeadingsConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[ExtractHeadingsConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[ExtractHeadingsConfig].toJson
  }
}
