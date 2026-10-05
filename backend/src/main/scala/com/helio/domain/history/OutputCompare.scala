package com.helio.domain.history

import spray.json.{JsNull, JsObject, JsString}

import java.time.Duration
import scala.util.Try

/** `outputs.config.compare` (HEL-1273, owner ruling D2): `previous_run | 1d | 7d | 30d |
 *  custom:<ISO-8601 duration>`. Pure; no I/O. A window is measured as a fixed-length [[Duration]]
 *  from the latest history point's UTC `captured_at`, so only day/time components are accepted
 *  (week/month/year have no fixed length). */
sealed trait OutputCompare

object OutputCompare {
  case object PreviousRun                extends OutputCompare
  final case class Window(by: Duration)  extends OutputCompare

  /** The owner tier's max history age (owner ruling D4): a longer window can never have a baseline. */
  val MaxWindow: Duration = Duration.ofDays(365)

  private val CustomDuration = """^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$""".r
  private val Prefix         = "custom:"
  private val Expected       = "compare must be one of previous_run, 1d, 7d, 30d or custom:<ISO-8601 duration in days/hours/minutes/seconds, 0 < d <= 365 days>"

  def parse(token: String): Either[String, OutputCompare] = token match {
    case "previous_run" => Right(PreviousRun)
    case "1d"           => Right(Window(Duration.ofDays(1)))
    case "7d"           => Right(Window(Duration.ofDays(7)))
    case "30d"          => Right(Window(Duration.ofDays(30)))
    case t if t.startsWith(Prefix) =>
      val d = t.substring(Prefix.length)
      // The regex goes first: `Duration.parse` alone accepts lowercase and signed forms. A bare
      // `P`/`PT` matches it (every component is optional) and is rejected by `Duration.parse`
      // itself, as is an overflowing digit run (hence the `Try`).
      if (CustomDuration.findFirstIn(d).isEmpty) Left(Expected)
      else
        Try(Duration.parse(d)).toOption match {
          case Some(dur) if !dur.isZero && !dur.isNegative && dur.compareTo(MaxWindow) <= 0 => Right(Window(dur))
          case _                                                                            => Left(Expected)
        }
    case _ => Left(Expected)
  }

  /** Reads `config.compare`: absent and JSON `null` both mean "no comparison" (`Right(None)`). */
  def fromConfig(config: JsObject): Either[String, Option[OutputCompare]] =
    config.fields.get("compare") match {
      case None | Some(JsNull) => Right(None)
      case Some(JsString(s))   => parse(s).map(Some(_))
      case Some(_)             => Left(Expected)
    }

  def validateConfig(config: JsObject): Either[String, Unit] = fromConfig(config).map(_ => ())
}
