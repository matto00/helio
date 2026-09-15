package com.helio.domain.steps

import spray.json._

import scala.util.{Failure, Success, Try}

/** HEL-1105: typed config for the `convertformat` step (design.md D1). A 1:1 row transform
 *  converting a `string-body` `field` between `csv`/`json` and `text`/`markdown`, writing the
 *  result to `outputField` (defaults to `field`).
 *
 *  Tolerant READ-path decode (HEL-814/HEL-860 contract): every key defaults when absent so a
 *  partially-configured or legacy row still opens/loads (`PipelineStepRepository.rowToDomain`
 *  must never throw on an unconfigured draft). A PRESENT-but-wrong-typed key still raises
 *  [[StepConfigTypeMismatch]], exactly like every other step's decoder. */
final case class ConvertFormatConfig(field: String, from: String, to: String, outputField: String)

object ConvertFormatConfig {

  def decode(raw: String): ConvertFormatConfig = {
    val obj         = StepCodecUtil.asObject(raw)
    val field       = StepCodecUtil.str(obj, "field", "")
    val from        = StepCodecUtil.str(obj, "from", "")
    val to          = StepCodecUtil.str(obj, "to", "")
    val outputField = StepCodecUtil.strOpt(obj, "outputField").filter(_.nonEmpty).getOrElse(field)
    ConvertFormatConfig(field, from, to, outputField)
  }

  /** Custom format (rather than a bare `jsonFormatN`) because `outputField`'s default is
   *  cross-field ("defaults to `field`"), which spray-json's per-field default mechanism cannot
   *  express -- mirrors [[UpsertSourceConfig]]'s own `read` delegating to `decode`. */
  implicit val format: RootJsonFormat[ConvertFormatConfig] = new RootJsonFormat[ConvertFormatConfig] {
    def write(c: ConvertFormatConfig): JsValue =
      JsObject(
        "field"       -> JsString(c.field),
        "from"        -> JsString(c.from),
        "to"          -> JsString(c.to),
        "outputField" -> JsString(c.outputField)
      )
    def read(json: JsValue): ConvertFormatConfig = decode(json.compactPrint)
  }

  /** WRITE-path pair check (design.md D1): a PRESENT `from`/`to` pair that decodes fine (both
   *  strings) but is not one of the four supported pairs -- including `from == to` and a cross
   *  pair such as `csv->markdown` -- is rejected here, named, at create/update time. A partially
   *  configured draft (either key absent) is NOT rejected here: that mirrors every other step's
   *  "legitimate to save, not yet legitimate to run" contract (`requiredConfigProblems` is the
   *  run/analyze-time enforcement of that instead, see [[ConvertFormatStep.companion]]). */
  def pairError(raw: String): Option[String] =
    Try(StepCodecUtil.asObject(raw)) match {
      case Success(obj) =>
        val fromOpt = obj.fields.get("from").collect { case JsString(s) => s }
        val toOpt   = obj.fields.get("to").collect { case JsString(s) => s }
        (fromOpt, toOpt) match {
          case (Some(f), Some(t)) if !ConvertFormatStep.SupportedPairs.contains((f, t)) =>
            Some(
              s"Invalid 'convertformat' config: unsupported from/to pair '$f' -> '$t'. Supported: " +
                ConvertFormatStep.SupportedPairs.map { case (a, b) => s"$a->$b" }.mkString(", ")
            )
          case _ => None
        }
      case Failure(_) => None
    }
}
