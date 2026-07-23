package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{AlertEventRepository, AlertRuleRepository}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try
import scala.util.control.NonFatal

/** HEL-466 — the alert rule evaluation runtime. `evaluateForDataType` is the
 *  single entry point, callable identically from `PipelineRunService
 *  .onRunSuccess` (this ticket's caller) and the future HEL-340 scheduler:
 *  it has zero dependency on `PipelineId`/`PipelineRunId`/`AuthenticatedUser`
 *  (design.md "Row representation" decision).
 *
 *  Loads every enabled rule for the target `DataTypeId` via the privileged
 *  `AlertRuleRepository.listEnabledByDataTypeInternal` (no request user in
 *  this background path), evaluates each independently, and drives
 *  `AlertEventRepository`'s privileged `upsertFiringInternal` (breach) /
 *  `resolveInternal` (clear) transitions — the sole write paths for
 *  `alert_events`, both of which route through `AlertEventStateMachine
 *  .transition` internally. */
final class AlertEvaluationService(
    alertRuleRepo: AlertRuleRepository,
    alertEventRepo: AlertEventRepository
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Numeric coercion consistent with `PipelineRunService.inferFieldType`
   *  (ticket.md's explicit instruction) — deliberately NOT
   *  `PipelineRowJson.toDouble`, which parses numeric-looking `String`s.
   *  Only genuinely numeric-typed values coerce; every `String` (numeric-
   *  looking or not), `Boolean`, `null`, and nested value is `None`. See
   *  design.md's "Numeric coercion policy" decision for the full rationale. */
  private[services] def numericValue(v: Any): Option[Double] = v match {
    case i: Int                   => Some(i.toDouble)
    case l: Long                  => Some(l.toDouble)
    case f: Float                 => Some(f.toDouble)
    case d: Double                => Some(d)
    case bd: BigDecimal           => Some(bd.toDouble)
    case bd: java.math.BigDecimal => Some(bd.doubleValue())
    case _                        => None
  }

  /** Metric extraction (design.md "Metric extraction" decision):
   *  `metric == "*"` -> row count, defined even for zero rows.
   *  Otherwise a single row yields that row's scalar `numericValue`; more
   *  than one row yields the sum of `numericValue` across the column,
   *  skipping rows where it is `None`. Zero rows with a non-`"*"` metric, a
   *  missing field, and an all-non-numeric column all yield `None` — "no
   *  value to extract", not a breach or a clear. */
  private[services] def extractMetric(metric: String, rows: Seq[PipelineRowJson.Row]): Option[Double] =
    if (metric == "*") Some(rows.size.toDouble)
    else if (rows.isEmpty) None
    else if (rows.size == 1) rows.head.get(metric).flatMap(numericValue)
    else {
      val values = rows.flatMap(_.get(metric).flatMap(numericValue))
      if (values.isEmpty) None else Some(values.sum)
    }

  private[services] def breaches(value: Double, comparator: Comparator, threshold: Double): Boolean =
    comparator match {
      case Comparator.Gt  => value > threshold
      case Comparator.Gte => value >= threshold
      case Comparator.Lt  => value < threshold
      case Comparator.Lte => value <= threshold
      case Comparator.Eq  => value == threshold
      case Comparator.Neq => value != threshold
    }

  /** Parses `condition.comparator`/`condition.threshold` out of the opaque
   *  jsonb blob. Throws (caught by the per-rule `recover` in
   *  `evaluateForDataType`) on a missing/malformed key or an unknown
   *  comparator — a bad rule must never block sibling rules. */
  private def parseCondition(condition: JsValue): (Comparator, Double) = {
    val obj            = condition.asJsObject
    val comparatorStr  = obj.fields("comparator").convertTo[String]
    val comparator     = Comparator.fromString(comparatorStr).fold(err => throw new IllegalArgumentException(err), identity)
    val threshold      = obj.fields("threshold").convertTo[Double]
    (comparator, threshold)
  }

  /** Load every enabled rule for `dataTypeId` and evaluate each against
   *  `rows` (the exact rows just written — no re-read). Each rule runs
   *  inside its own `Future` wrapped in `recover`, so one rule's exception
   *  (bad `condition` JSON, coercion failure, repository error) is logged
   *  and never blocks sibling rules for the same `DataTypeId`. Callers (e.g.
   *  `PipelineRunService.onRunSuccess`) additionally wrap the whole call so a
   *  defect here can never fail the triggering pipeline run. */
  def evaluateForDataType(
      dataTypeId: DataTypeId,
      rows: Seq[PipelineRowJson.Row],
      triggeringRunId: Option[String]
  ): Future[Unit] =
    alertRuleRepo.listEnabledByDataTypeInternal(dataTypeId).flatMap { rules =>
      Future
        .sequence(rules.map { rule =>
          evaluateRule(rule, rows, triggeringRunId).recover {
            case NonFatal(e) =>
              log.error(
                "AlertEvaluationService: evaluation failed for rule={} dataTypeId={} triggeringRunId={}",
                rule.id.value, dataTypeId.value, triggeringRunId.getOrElse("none"), e
              )
              ()
          }
        })
        .map(_ => ())
    }

  private def evaluateRule(rule: AlertRule, rows: Seq[PipelineRowJson.Row], triggeringRunId: Option[String]): Future[Unit] =
    Future.fromTry(Try {
      extractMetric(rule.metric, rows).map { value =>
        val (comparator, threshold) = parseCondition(rule.condition)
        (value, breaches(value, comparator, threshold))
      }
    }).flatMap {
      case None =>
        // Skipped extraction (zero rows / missing field / non-numeric value)
        // — no breach, no auto-resolve.
        Future.successful(())
      case Some((value, true)) =>
        alertEventRepo
          .upsertFiringInternal(rule.id, rule.ownerId, rule.targetDataTypeId, JsNumber(value), triggeringRunId, rule.severity)
          .map { event =>
            log.info(
              "AlertEvaluationService: rule={} event={} state={} severity={} dataTypeId={} triggeringRunId={}",
              rule.id.value, event.id.value, AlertEventState.asString(event.state),
              Severity.asString(event.severity), rule.targetDataTypeId.value, triggeringRunId.getOrElse("none")
            )
          }
      case Some((_, false)) =>
        alertEventRepo.resolveInternal(rule.id).map {
          case Some(event) =>
            log.info(
              "AlertEvaluationService: rule={} event={} state={} severity={} dataTypeId={} triggeringRunId={}",
              rule.id.value, event.id.value, AlertEventState.asString(event.state),
              Severity.asString(event.severity), rule.targetDataTypeId.value, triggeringRunId.getOrElse("none")
            )
          case None =>
            () // no active event, or active event was snoozed — no-op
        }
    }
}
