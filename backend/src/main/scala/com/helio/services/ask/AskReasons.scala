package com.helio.services.ask

/** HEL-1761 D5: the reasons an ask `422 ASK_UNGROUNDED` returns to a client. The validator's reasons quote the rejected
 *  value (`numeral '99' ...`), which would hand the client the very text the answer was refused for; the public form is a
 *  fixed phrase per reason kind, deduplicated, and never holds a digit. */
object AskReasons {

  val Unchecked: String = "the answer could not be checked against the data"

  private val categories: Vector[(String => Boolean, String)] = Vector(
    (_.startsWith("the text is empty"), "the answer was empty"),
    (_.startsWith("numeral "), "a number is not backed by a cited value"),
    (_.startsWith("date "), "a date is not backed by a cited date"),
    (_.startsWith("citation marker "), "a citation marker is not in the data"),
    (r => r.startsWith("the text has ") && r.contains("characters"), "the answer is too long"),
    (r => r.startsWith("the text has ") && r.contains("sentences"), "the answer has too many sentences"),
    (_.startsWith("the tool-call budget"), "the tool-call budget was reached before an answer")
  )

  def publicOf(reasons: Vector[String]): Vector[String] =
    reasons.map { r =>
      categories.collectFirst { case (matches, phrase) if matches(r) => phrase }.getOrElse(Unchecked).filterNot(_.isDigit)
    }.distinct
}
