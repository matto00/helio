package com.helio.domain.insights

import java.time.{Instant, LocalDate, ZoneOffset}
import scala.util.Try
import scala.util.matching.Regex

/** HEL-1741 D7: accepts a model output only when every marker, number and date in it traces to a citation in the
 *  same sentence. A numeral is any digit run (deliberately strict: `Q3` yields `3`); number words are not checked
 *  (documented limit). */
object InsightValidator {

  private val Marker  = """\[(c\d+)\]""".r
  private val IsoDate = """(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?""".r
  private val Numeral =
    """[-+]?\$?[-+]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([kKMB](?![A-Za-z]))?(%|(?:st|nd|rd|th)(?![A-Za-z]))?""".r

  /** Reasons the text is rejected; empty means accepted. */
  def validate(text: String, pack: InsightPack, maxSentences: Int, maxChars: Int): Vector[String] =
    if (text.trim.isEmpty) Vector("the text is empty")
    else {
      val byId     = pack.citationById
      val ids      = Marker.findAllMatchIn(text).map(_.group(1)).toVector
      val unknown  = ids.distinct.filterNot(byId.contains).map(id => s"citation marker [$id] is not in the pack")
      val stripped = Marker.replaceAllIn(text, "").trim
      val length   = if (stripped.length > maxChars) Vector(s"the text has ${stripped.length} characters, more than $maxChars") else Vector.empty
      val sentences = splitSentences(text)
      val count    = if (sentences.size > maxSentences) Vector(s"the text has ${sentences.size} sentences, more than $maxSentences") else Vector.empty
      (unknown ++ length ++ count ++ sentences.flatMap(checkSentence(_, byId))).distinct
    }

  /** Citation ids used in `text`, in order of first use, restricted to the pack. */
  def citationsUsed(text: String, pack: InsightPack): Vector[String] = {
    val byId = pack.citationById
    Marker.findAllMatchIn(text).map(_.group(1)).toVector.distinct.filter(byId.contains)
  }

  /** Splits on `.`/`!`/`?` followed by whitespace or end; a `.` between two digits is not a boundary. */
  def splitSentences(text: String): Vector[String] = {
    val out   = Vector.newBuilder[String]
    var start = 0
    var i     = 0
    while (i < text.length) {
      val c = text.charAt(i)
      if (c == '.' || c == '!' || c == '?') {
        val betweenDigits = c == '.' && i > 0 && i + 1 < text.length && text.charAt(i - 1).isDigit && text.charAt(i + 1).isDigit
        val atBoundary    = i + 1 == text.length || text.charAt(i + 1).isWhitespace
        if (!betweenDigits && atBoundary) {
          out += text.substring(start, i + 1)
          start = i + 1
        }
      }
      i += 1
    }
    out += text.substring(start)
    out.result().filter(_.trim.nonEmpty)
  }

  private def utcDate(i: Instant) = i.atOffset(ZoneOffset.UTC).toLocalDate

  private def checkSentence(sentence: String, byId: Map[String, Citation]): Vector[String] = {
    val cited      = Marker.findAllMatchIn(sentence).flatMap(m => byId.get(m.group(1))).toVector
    val numbers    = cited.flatMap(_.number)
    val pcts       = cited.filter(_.isPct).flatMap(_.number)
    val dates      = cited.flatMap(_.date).map(utcDate)
    val bare       = Marker.replaceAllIn(sentence, " ")
    val dateReasons = IsoDate.findAllMatchIn(bare).toVector.flatMap { m =>
      val ok = Try(LocalDate.parse(m.group(1))).toOption.exists(dates.contains)
      if (ok) None else Some(s"date '${m.group(1)}' does not match any date cited in its sentence")
    }
    val noDates = IsoDate.replaceAllIn(bare, " ")
    val numeralReasons = Numeral.findAllMatchIn(noDates).toVector.flatMap { m =>
      if (numeralMatches(m, numbers, pcts, dates)) None
      else Some(s"numeral '${m.matched.trim}' does not match any value cited in its sentence")
    }
    dateReasons ++ numeralReasons
  }

  private def numeralMatches(m: Regex.Match, numbers: Vector[Double], pcts: Vector[Double], dates: Vector[LocalDate]): Boolean = {
    val digits   = m.group(1).replace(",", "")
    val decimals = Option(m.group(2)).map(_.length - 1).getOrElse(0)
    val magnitude = Option(m.group(3)).map {
      case "k" | "K" => 1e3
      case "M"       => 1e6
      case _         => 1e9
    }.getOrElse(1.0)
    val suffix   = Option(m.group(4))
    val parsed   = (digits + Option(m.group(2)).getOrElse("")).toDouble
    val x        = parsed * magnitude
    val unit     = math.pow(10, -decimals) * magnitude
    def near(v: Double): Boolean = math.abs(x - math.abs(v)) <= unit / 2 + 1e-9 * math.max(1.0, math.abs(v))
    if (suffix.contains("%")) pcts.exists(near)
    else {
      val isOrdinal = suffix.exists(_ != "%")
      val plainInt  = decimals == 0 && magnitude == 1.0 && !m.group(1).contains(",")
      val day       = plainInt && parsed >= 1 && parsed <= 31 && dates.exists(_.getDayOfMonth == parsed.toInt)
      val year      = plainInt && !isOrdinal && digits.length == 4 && parsed >= 1900 && parsed <= 2100 && dates.exists(_.getYear == parsed.toInt)
      numbers.exists(near) || day || year
    }
  }
}
