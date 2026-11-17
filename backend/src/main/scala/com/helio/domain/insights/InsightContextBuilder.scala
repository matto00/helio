package com.helio.domain.insights

import com.helio.domain.history.OutputCompare
import spray.json._

import java.time.{Instant, LocalDate, LocalDateTime, OffsetDateTime, ZoneOffset}
import scala.annotation.tailrec
import scala.collection.mutable.ArrayBuffer
import scala.util.Try

/** The request an insight render sends, plus the pack it was built from and its input-token estimate. */
final case class InsightBuiltPrompt(system: String, user: String, pack: InsightPack, estimate: Int)

/** HEL-1741 D3-D5: builds the bounded, cited grounding pack. Pure: built only from [[InsightInputs]]. */
object InsightContextBuilder {

  private val PlainNumber = """^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$""".r
  private val IsoDate     = """^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$""".r

  /** Builds the prompt, shedding data while over `limits.maxInputTokens` (D5): halve head rows to 0, then drop
   *  window points oldest first, then drop compares from the end. `Left(estimate)` when even the minimal pack is
   *  over budget. */
  def build(
      inputs: InsightInputs,
      preset: InsightPreset,
      spec: InsightRenderSpec,
      limits: InsightLimits,
      estimator: Seq[String] => Int
  ): Either[Int, InsightBuiltPrompt] = {
    val system = InsightPrompts.system(spec)

    @tailrec def loop(in: InsightInputs, keepRows: Int): Either[Int, InsightBuiltPrompt] = {
      val built    = pack(in, keepRows, limits)
      val user     = InsightPrompts.user(preset, spec, built.serialized)
      val estimate = estimator(Seq(system, user))
      if (estimate <= limits.maxInputTokens) Right(InsightBuiltPrompt(system, user, built, estimate))
      else
        shed(in, keepRows) match {
          case Some((nextInputs, nextKeep)) => loop(nextInputs, nextKeep)
          case None                         => Left(estimate)
        }
    }

    loop(inputs, math.min(limits.maxHeadRows, inputs.head.map(_.rows.size).getOrElse(0)))
  }

  private def shed(in: InsightInputs, keepRows: Int): Option[(InsightInputs, Int)] =
    if (keepRows > 0) Some((in, keepRows / 2))
    else if (in.windows.exists(_.points.nonEmpty)) Some((dropOldestPoints(in), keepRows))
    else if (in.windows.nonEmpty) Some((in.copy(windows = Vector.empty), keepRows))
    else if (in.compares.nonEmpty) Some((in.copy(compares = in.compares.init), keepRows))
    else None

  /** Drops the oldest ~12% of the remaining points (at least one) across all windows; empty windows go. */
  private def dropOldestPoints(in: InsightInputs): InsightInputs = {
    val all    = in.windows.flatMap(_.points.map(_._1)).sorted
    val drop   = math.max(1, all.size / 8)
    val cutoff = all(drop - 1)
    val windows = in.windows.map(w => w.copy(points = w.points.filter(_._1.isAfter(cutoff)))).filter(_.points.nonEmpty)
    in.copy(windows = windows)
  }

  /** Builds the pack from the inputs with the first `keepRows` head rows. Ids are assigned in traversal order
   *  (compares, windows, head), so repeated builds are stable. */
  def pack(in: InsightInputs, keepRows: Int, limits: InsightLimits): InsightPack = {
    val b       = new Cells(limits)
    val compares = in.compares.map(b.compareJson)
    val windows  = in.windows.map(b.windowJson)
    val head     = in.head.map(h => b.headJson(h, keepRows))
    val citations = b.citations.toVector
    val json = JsObject(
      Map[String, JsValue](
        "citations" -> JsArray(citations.map(citationJson)),
        "compares"  -> JsArray(compares),
        "windows"   -> JsArray(windows)
      ) ++ head.map("head" -> _)
    )
    InsightPack(json, citations, serialize(json))
  }

  /** D4: spray-json does not escape angle brackets, so after compact printing every `<`, `>` and `&` becomes its
   *  JSON unicode escape (same decoded value) and no cell can contain the delimiter text. */
  private def serialize(json: JsObject): String =
    json.compactPrint.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

  private def citationJson(c: Citation): JsValue =
    JsObject(
      "id"         -> JsString(c.id),
      "outputId"   -> JsString(c.outputId),
      "field"      -> JsString(c.field),
      "value"      -> c.number.map(n => JsNumber(n): JsValue).orElse(c.date.map(d => JsString(d.toString))).getOrElse(JsNull),
      "capturedAt" -> c.capturedAt.map(t => JsString(t.toString): JsValue).getOrElse(JsNull)
    )

  /** An ISO date or date-time string as a UTC instant; `None` for any other string. */
  def parseIsoDate(s: String): Option[Instant] =
    if (IsoDate.findFirstIn(s).isEmpty) None
    else if (s.length == 10) Try(LocalDate.parse(s).atStartOfDay().toInstant(ZoneOffset.UTC)).toOption
    else
      Try(OffsetDateTime.parse(s.replace(' ', 'T')).toInstant).toOption
        .orElse(Try(LocalDateTime.parse(s.replace(' ', 'T')).toInstant(ZoneOffset.UTC)).toOption)

  /** A string cell whose trimmed text is a finite plain number (optional sign, `,` thousands groups, decimals). */
  def parsePlainNumber(s: String): Option[Double] = {
    val t = s.trim
    if (PlainNumber.findFirstIn(t).isEmpty) None
    else Try(t.replace(",", "").toDouble).toOption.filter(d => !d.isNaN && !d.isInfinite)
  }

  /** Citation assignment and JSON for each pack part. One instance per pack build. */
  private final class Cells(limits: InsightLimits) {
    val citations = ArrayBuffer.empty[Citation]

    private def next(): String = s"c${citations.size + 1}"

    private def trunc(s: String): String = if (s.length > limits.maxCellChars) s.substring(0, limits.maxCellChars) else s

    private def cell(c: Citation, v: JsValue): JsValue = {
      citations += c
      JsObject("cite" -> JsString(c.id), "v" -> v)
    }

    private def num(outputId: String, field: String, value: Double, at: Option[Instant], shown: JsValue, isPct: Boolean = false): JsValue =
      cell(Citation(next(), outputId, trunc(field), Some(value), None, at, isPct), shown)

    private def date(outputId: String, field: String, at: Instant, captured: Option[Instant], shown: Option[String] = None): JsValue =
      cell(Citation(next(), outputId, trunc(field), None, Some(at), captured), JsString(shown.getOrElse(at.toString)))

    private def optNum(outputId: String, field: String, value: Option[Double], at: Option[Instant], isPct: Boolean = false): JsValue =
      value.filter(v => !v.isNaN && !v.isInfinite).map(v => num(outputId, field, v, at, JsNumber(v), isPct)).getOrElse(JsNull)

    private def optDate(outputId: String, field: String, value: Option[Instant]): JsValue =
      value.map(d => date(outputId, field, d, Some(d))).getOrElse(JsNull)

    def compareJson(c: InsightCompare): JsValue = {
      val id = c.outputId
      val f  = c.field
      val windowDays = OutputCompare.parse(c.compare).toOption.collect { case OutputCompare.Window(d) if d.toDays >= 1 => d.toDays }
      JsObject(
        "outputId"          -> JsString(id),
        "outputName"        -> JsString(trunc(c.outputName)),
        "field"             -> JsString(trunc(f)),
        "compare"           -> JsString(trunc(c.compare)),
        "current"           -> optNum(id, s"$f.current", c.current, c.currentAt),
        "baseline"          -> optNum(id, s"$f.baseline", c.baseline, c.baselineAt),
        "delta"             -> optNum(id, s"$f.delta", c.delta, c.currentAt),
        "pct"               -> optNum(id, s"$f.pct", c.pct, c.currentAt, isPct = true),
        "currentAt"         -> optDate(id, s"$f.currentAt", c.currentAt),
        "baselineAt"        -> optDate(id, s"$f.baselineAt", c.baselineAt),
        "compareWindowDays" -> windowDays.map(d => num(id, "compareWindowDays", d.toDouble, c.currentAt, JsNumber(d))).getOrElse(JsNull)
      )
    }

    def windowJson(w: InsightWindow): JsValue =
      JsObject(
        "outputId" -> JsString(w.outputId),
        "label"    -> JsString(trunc(w.label)),
        "points" -> JsArray(w.points.map { case (at, value) =>
          val t = date(w.outputId, s"${w.label}.t", at, Some(at))
          val v = optNum(w.outputId, s"${w.label}.value", Some(value), Some(at))
          JsObject("t" -> t, "v" -> v): JsValue
        })
      )

    def headJson(h: InsightHead, keepRows: Int): JsValue = {
      val at        = Some(h.capturedAt)
      val capturedAt = date(h.outputId, "head.capturedAt", h.capturedAt, at)
      val rowCount   = num(h.outputId, "headRowCount", h.rows.size.toDouble, at, JsNumber(h.rows.size))
      val columns    = h.columns.map(c => JsString(trunc(c)): JsValue)
      val rows = h.rows.take(keepRows).zipWithIndex.map { case (row, i) =>
        val rank = num(h.outputId, "rank", (i + 1).toDouble, at, JsNumber(i + 1))
        JsObject("rank" -> rank, "data" -> rowJson(h, row, at)): JsValue
      }
      JsObject(
        "outputId"   -> JsString(h.outputId),
        "capturedAt" -> capturedAt,
        "columns"    -> JsArray(columns),
        "rowCount"   -> rowCount,
        "rows"       -> JsArray(rows)
      )
    }

    private def rowJson(h: InsightHead, row: JsObject, at: Option[Instant]): JsObject = {
      val ordered = h.columns.filter(row.fields.contains) ++ row.fields.keys.filterNot(h.columns.contains).toVector.sorted
      JsObject(ordered.map(k => trunc(k) -> valueCell(h.outputId, k, row.fields(k), at)).toMap)
    }

    private def valueCell(outputId: String, field: String, value: JsValue, at: Option[Instant]): JsValue = value match {
      case JsNumber(n) if !n.toDouble.isInfinite && !n.toDouble.isNaN => num(outputId, field, n.toDouble, at, JsNumber(n))
      case JsNumber(_)  => JsNull
      case JsString(s) =>
        parsePlainNumber(s) match {
          case Some(n) => num(outputId, field, n, at, JsString(s))
          case None =>
            parseIsoDate(s.trim) match {
              case Some(d) => date(outputId, field, d, at, Some(trunc(s)))
              case None    => JsString(trunc(s))
            }
        }
      case b: JsBoolean => b
      case JsNull       => JsNull
      case other        => JsString(trunc(other.compactPrint))
    }
  }
}
