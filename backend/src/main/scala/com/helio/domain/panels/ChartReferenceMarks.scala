package com.helio.domain.panels

import spray.json.{JsArray, JsNull, JsNumber, JsObject, JsString, JsValue}

/** HEL-1306: validation of a chart Output's `referenceLines` / `referenceBands` config keys (static target
 *  values drawn on the value axis). Pure; the caps, label limit and tone vocabulary live here and are pinned to
 *  the frontend constants and the three Output request schemas by the shared `chart-reference-marks.json`
 *  fixture. The shape is judged only for a key a write changes from its stored value (the tolerance rule of
 *  `OutputConfigValidation`), and independently of `chartType`: a stored mark on a chart type that cannot
 *  draw it is preserved, not rejected. */
object ChartReferenceMarks {

  val LinesKey: String = "referenceLines"
  val BandsKey: String = "referenceBands"

  val MaxLines: Int = 5
  val MaxBands: Int = 3
  val MaxLabel: Int = 60

  /** The tone vocabulary shared with HEL-1307; the colour a tone resolves to is a frontend theme concern. */
  val Tones: Vector[String] = Vector("neutral", "success", "warning", "error")

  private val LineKeys = Set("value", "label", "tone")
  private val BandKeys = Set("from", "to", "label", "tone")

  /** Prose for `OutputConfigValidation.KeysDoc`, built from the constants so it cannot drift. */
  val Doc: String =
    s"$LinesKey is null or at most $MaxLines objects { value, label?, tone? } and $BandsKey is null or at most $MaxBands " +
      s"objects { from, to, label?, tone? } with from less than to (static reference lines/bands on a chart's value axis); " +
      s"value/from/to are finite numbers, label is $MaxLabel characters at most (not blank), tone is one of ${Tones.mkString(", ")}."

  def validate(written: JsObject, stored: JsObject): Either[String, Unit] =
    changed(written, stored, LinesKey).fold[Either[String, Unit]](Right(()))(validateLines)
      .flatMap(_ => changed(written, stored, BandsKey).fold[Either[String, Unit]](Right(()))(validateBands))

  private def changed(written: JsObject, stored: JsObject, key: String): Option[JsValue] =
    written.fields.get(key).filter(v => !stored.fields.get(key).contains(v))

  private def validateLines(value: JsValue): Either[String, Unit] = value match {
    case JsNull => Right(())
    case JsArray(items) if items.size > MaxLines => Left(s"$LinesKey allows at most $MaxLines lines")
    case JsArray(items) => firstError(items.zipWithIndex.map { case (item, i) => () => validateItem(LinesKey, i, item, LineKeys, Vector("value")) })
    case _ => Left(s"$LinesKey must be an array of { value, label?, tone? } objects (or null)")
  }

  private def validateBands(value: JsValue): Either[String, Unit] = value match {
    case JsNull => Right(())
    case JsArray(items) if items.size > MaxBands => Left(s"$BandsKey allows at most $MaxBands bands")
    case JsArray(items) =>
      firstError(items.zipWithIndex.map { case (item, i) =>
        () => validateItem(BandsKey, i, item, BandKeys, Vector("from", "to")).flatMap(_ => orderedBand(i, item.asJsObject))
      })
    case _ => Left(s"$BandsKey must be an array of { from, to, label?, tone? } objects (or null)")
  }

  private def firstError(checks: Vector[() => Either[String, Unit]]): Either[String, Unit] =
    checks.iterator.map(_.apply()).collectFirst { case l @ Left(_) => l }.getOrElse(Right(()))

  private def finite(v: JsValue): Option[Double] = v match {
    case JsNumber(n) => Some(n.toDouble).filter(d => !d.isInfinite && !d.isNaN)
    case _           => None
  }

  private def validateItem(key: String, index: Int, item: JsValue, allowed: Set[String], numeric: Vector[String]): Either[String, Unit] = {
    val at = s"$key[$index]"
    item match {
      case obj: JsObject =>
        val extra = (obj.fields.keySet -- allowed).toVector.sorted
        if (extra.nonEmpty) Left(s"$at has unknown key(s): ${extra.mkString(", ")}")
        else numeric.collectFirst { case f if obj.fields.get(f).flatMap(finite).isEmpty => Left(s"$at.$f must be a finite number") }
          .getOrElse(Right(()))
          .flatMap(_ => validateLabel(at, obj))
          .flatMap(_ => validateTone(at, obj))
      case _ => Left(s"$at must be an object")
    }
  }

  private def validateLabel(at: String, obj: JsObject): Either[String, Unit] = obj.fields.get("label") match {
    case None => Right(())
    case Some(JsString(s)) if codePoints(s) >= 1 && codePoints(s) <= MaxLabel && s.exists(!_.isWhitespace) => Right(())
    case Some(_) => Left(s"$at.label must be 1 to $MaxLabel characters with at least one non-whitespace character")
  }

  /** Code points, as JSON Schema `maxLength` counts them (a UTF-16 `length` would reject 31 emoji). */
  private def codePoints(s: String): Int = s.codePointCount(0, s.length)

  private def validateTone(at: String, obj: JsObject): Either[String, Unit] = obj.fields.get("tone") match {
    case None => Right(())
    case Some(JsString(t)) if Tones.contains(t) => Right(())
    case Some(_) => Left(s"$at.tone must be one of ${Tones.mkString(", ")}")
  }

  private def orderedBand(index: Int, band: JsObject): Either[String, Unit] =
    (finite(band.fields("from")), finite(band.fields("to"))) match {
      case (Some(from), Some(to)) if from >= to => Left(s"$BandsKey[$index]: from must be less than to")
      case _                                    => Right(())
    }
}
