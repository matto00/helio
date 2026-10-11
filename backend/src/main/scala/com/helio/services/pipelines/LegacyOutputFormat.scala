package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import spray.json._

/** HEL-1441: the Scala mirror of migration V118's repair (HEL-1410, section 3's DO block in
 *  `V118__map_legacy_metric_format_objects.sql`; the header there documents the mapping).
 *
 *  V118 turned the legacy object-valued `format` on metric/collection Outputs into a string format. Patch-set
 *  journals were not rewritten, so a journal written before V118 can still hold the object. Anything that
 *  writes a previously captured Output config back to storage calls [[normaliseRestored]], so the stored
 *  result equals what V117 then V118 would have produced.
 *
 *  `LegacyOutputFormatParitySpec` runs V118's real DO block over a corpus and fails if this object and the
 *  SQL disagree -- change one, change both (V118 is immutable, so a mismatch means this object is wrong). */
object LegacyOutputFormat {

  /** The one place the V117-then-V118 order lives (V118 ran after V117 on stored data). */
  def normaliseRestored(kind: OutputKind, config: JsObject): JsObject =
    normalise(kind, LegacyOutputConfigKeys.normalise(kind, config))

  def normalise(kind: OutputKind, config: JsObject): JsObject =
    (kind, config.fields.get("format")) match {
      case (OutputKind.Metric | OutputKind.Collection, Some(fmt: JsObject)) => mapObject(kind, config, fmt)
      case _                                                                 => config
    }

  /** V118's `btrim(v, E' \t\r\n')`: NOT `String.trim` / `strip`, which also strip other characters. */
  private val TrimmedChars = Set(' ', '\t', '\r', '\n')

  private def btrim(s: String): String =
    s.dropWhile(TrimmedChars).reverse.dropWhile(TrimmedChars).reverse

  private def text(fmt: JsObject, key: String): Option[String] = fmt.fields.get(key) match {
    case Some(JsString(s)) => Some(btrim(s)).filter(_.nonEmpty)
    case _                 => None
  }

  private def validDecimals(fmt: JsObject): Option[BigDecimal] = fmt.fields.get("decimals") match {
    case Some(JsNumber(n)) if n.signum >= 0 && n.isWhole => Some(n)
    case _                                               => None
  }

  private def mapObject(kind: OutputKind, config: JsObject, fmt: JsObject): JsObject = {
    val decimals = validDecimals(fmt)
    val prefix   = text(fmt, "prefix")
    val currency = decimals.forall(_ == 2) && prefix.contains("$")
    val newFormat =
      if (decimals.contains(BigDecimal(0))) "integer"
      else if (currency) "currency"
      else "number"
    val consumed = newFormat == "currency"

    val parts = Vector(prefix.filterNot(_ => consumed), text(fmt, "unit"), text(fmt, "suffix")).flatten
    val liveUnitFree = config.fields.get("unit").forall(_ == JsNull)
    val withFormat = config.fields + ("format" -> JsString(newFormat))
    val fields =
      if (kind == OutputKind.Metric && parts.nonEmpty && liveUnitFree) withFormat + ("unit" -> JsString(parts.mkString(" ")))
      else withFormat
    JsObject(fields)
  }
}
