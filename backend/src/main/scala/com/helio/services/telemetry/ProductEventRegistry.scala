package com.helio.services.telemetry

import spray.json._

import java.time.{Duration, Instant}
import scala.util.Try
import scala.util.matching.Regex

/** A validated event ready to store: `properties` is already restricted to allow-listed keys with
 *  in-range values, so the repository never re-validates. */
final case class ValidatedProductEvent(event: String, properties: JsObject, occurredAt: Instant)

/** The single allow-list of product events and the typed property each may carry (HEL-1208
 *  design.md Decision 5). There is deliberately no free-form payload: an event with an unlisted
 *  property key is rejected, not silently trimmed. The V113 `CHECK` constraint duplicates
 *  [[AllEventNames]] as defence in depth; a test asserts the two sets stay equal. */
object ProductEventRegistry {

  sealed trait PropertyType { def accepts(value: JsValue): Boolean }

  final case class IntRange(min: Int, max: Int) extends PropertyType {
    def accepts(value: JsValue): Boolean = value match {
      case JsNumber(n) => n.isValidInt && n.toInt >= min && n.toInt <= max
      case _           => false
    }
  }

  final case class OneOf(values: Set[String]) extends PropertyType {
    def accepts(value: JsValue): Boolean = value match {
      case JsString(s) => values.contains(s)
      case _           => false
    }
  }

  final case class Slug(pattern: Regex) extends PropertyType {
    def accepts(value: JsValue): Boolean = value match {
      case JsString(s) => pattern.matches(s)
      case _           => false
    }
  }

  val SignupCompleted          = "signup_completed"
  val FirstDashboardRendered   = "first_dashboard_rendered"
  val ProvenanceOpened         = "provenance_opened"
  val FirstrunFileDropped      = "firstrun_file_dropped"
  val FirstrunDashboardCreated = "firstrun_dashboard_created"
  val FirstrunTemplateChosen   = "firstrun_template_chosen"

  private val PanelCount = IntRange(1, 500)

  /** Events a client may POST, with the allow-listed property keys for each. */
  val ClientEvents: Map[String, Map[String, PropertyType]] = Map(
    FirstDashboardRendered   -> Map("panelCount" -> PanelCount),
    ProvenanceOpened         -> Map.empty,
    FirstrunFileDropped      -> Map("source" -> OneOf(Set("drop", "paste"))),
    FirstrunDashboardCreated -> Map("panelCount" -> PanelCount),
    FirstrunTemplateChosen   -> Map("template" -> Slug("^[a-z0-9-]{1,40}$".r))
  )

  /** Emitted only by the server; a client posting these is rejected. */
  val ServerOnlyEvents: Set[String] = Set(SignupCompleted)

  val AllEventNames: Set[String] = ClientEvents.keySet ++ ServerOnlyEvents

  /** Events stored at most once per user, enforced by the partial unique index. They are also
   *  exempt from the retention purge: one timestamp-only row per user, needed for TTFD and dedupe. */
  val OncePerUserEvents: Set[String] = Set(SignupCompleted, FirstDashboardRendered)

  /** Template slugs rolled up as-is; anything else buckets to `other` so rollup cardinality stays
   *  bounded. Empty until the first-run leaf declares real template slugs. */
  val RolledUpTemplateSlugs: Set[String] = Set.empty

  val MaxBatchSize: Int = 25

  private val MaxPastSkew   = Duration.ofHours(24)
  private val MaxFutureSkew = Duration.ofMinutes(5)

  /** Client-supplied `occurredAt` is honoured only inside `[now-24h, now+5min]` (offline
   *  tolerance without letting a client rewrite history); otherwise the server time is used. */
  def clampOccurredAt(claimed: Option[Instant], now: Instant): Instant =
    claimed.filter(t => !t.isBefore(now.minus(MaxPastSkew)) && !t.isAfter(now.plus(MaxFutureSkew))).getOrElse(now)

  /** Validates one client-posted event. `Left` carries a message safe to echo to the client. */
  def validateClientEvent(raw: JsValue, now: Instant): Either[String, ValidatedProductEvent] =
    raw match {
      case obj: JsObject =>
        val fields = obj.fields
        val unknownTop = fields.keySet -- Set("event", "properties", "occurredAt")
        if (unknownTop.nonEmpty) Left(s"unknown field(s): ${unknownTop.toSeq.sorted.mkString(", ")}")
        else
          fields.get("event") match {
            case Some(JsString(name)) if ServerOnlyEvents.contains(name) =>
              Left(s"event '$name' cannot be emitted by a client")
            case Some(JsString(name)) =>
              ClientEvents.get(name) match {
                case None          => Left(s"unknown event '$name'")
                case Some(allowed) => validateProperties(name, allowed, fields.get("properties"), fields.get("occurredAt"), now)
              }
            case _ => Left("event must be a string")
          }
      case _ => Left("each event must be an object")
    }

  private def validateProperties(
      name: String,
      allowed: Map[String, PropertyType],
      rawProps: Option[JsValue],
      rawOccurredAt: Option[JsValue],
      now: Instant
  ): Either[String, ValidatedProductEvent] = {
    val props: Either[String, Map[String, JsValue]] = rawProps match {
      case None | Some(JsNull) => Right(Map.empty)
      case Some(o: JsObject)   => Right(o.fields)
      case Some(_)             => Left("properties must be an object")
    }
    val claimed: Either[String, Option[Instant]] = rawOccurredAt match {
      case None | Some(JsNull) => Right(None)
      case Some(JsString(s))   => Try(Instant.parse(s)).toOption.toRight("occurredAt must be an ISO-8601 instant").map(Some(_))
      case Some(_)             => Left("occurredAt must be a string")
    }
    for {
      p <- props
      t <- claimed
      _ <- p.keys.find(!allowed.contains(_)).fold[Either[String, Unit]](Right(()))(k => Left(s"unknown property '$k' for event '$name'"))
      _ <- p.collectFirst { case (k, v) if !allowed(k).accepts(v) => k }
             .fold[Either[String, Unit]](Right(()))(k => Left(s"invalid value for property '$k' of event '$name'"))
    } yield ValidatedProductEvent(name, JsObject(p), clampOccurredAt(t, now))
  }
}
