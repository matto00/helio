package com.helio.domain.outputs

import com.helio.domain.model.OutputKind
import spray.json.{JsArray, JsNull, JsNumber, JsObject, JsString, JsValue}

/** `outputs.config.conditionalFormats` (HEL-1307): an ordered list (first match wins) of threshold rules
 *  `{op, value, value2?, tone, label?, column?, target?}` that colour a metric value, a collection item or a
 *  table cell/row. Pure; no I/O. This is the SHAPE check only -- evaluation lives in the frontend renderers,
 *  which compare the raw (unformatted) value. Messages are `conditionalFormats[<i>]: <reason>`.
 *
 *  Only metric, table and collection carry the key; for any other kind this returns `Right` because the
 *  per-kind known-key check (`OutputConfigValidation`) owns that rejection. A JSON `null` inside a rule for an
 *  optional key (`value2`, `label`, `column`, `target`) means absent; `null` and `[]` for the whole key mean
 *  "no rules". A `column` naming a column the data does not have is accepted (it never matches at render). */
object ConditionalFormats {

  val Key = "conditionalFormats"
  val MaxRules = 20
  val MaxLabel = 60
  val MaxText  = 200

  private val NumericOps = Set("gt", "gte", "lt", "lte", "between")
  private val TextOps    = Set("eq", "neq")
  val Ops: Vector[String]   = Vector("gt", "gte", "lt", "lte", "between", "eq", "neq")
  val Tones: Vector[String] = Vector("success", "warning", "error")
  private val Targets      = Set("cell", "row")
  private val RuleKeys     = Set("op", "value", "value2", "tone", "label", "column", "target")

  def validateConfig(kind: OutputKind, config: JsObject): Either[String, Unit] =
    if (!supports(kind)) Right(())
    else
      config.fields.get(Key) match {
        case None | Some(JsNull) => Right(())
        case Some(JsArray(rules)) =>
          if (rules.size > MaxRules) Left(s"$Key: at most $MaxRules rules are allowed (got ${rules.size})")
          else
            rules.zipWithIndex.iterator.map { case (r, i) => validateRule(kind, r).left.map(reason => s"$Key[$i]: $reason") }
              .collectFirst { case l @ Left(_) => l }.getOrElse(Right(()))
        case Some(_) => Left(s"$Key must be an array of rules (or null to clear)")
      }

  private def supports(kind: OutputKind): Boolean =
    kind == OutputKind.Metric || kind == OutputKind.Table || kind == OutputKind.Collection

  /** A present, non-null field value. */
  private def field(o: JsObject, k: String): Option[JsValue] = o.fields.get(k).filter(_ != JsNull)

  private def validateRule(kind: OutputKind, raw: JsValue): Either[String, Unit] = raw match {
    case o: JsObject =>
      val unknown = o.fields.keySet -- RuleKeys
      if (unknown.nonEmpty) Left(s"unknown key ${unknown.toVector.sorted.map(k => s"`$k`").mkString(", ")} (allowed: ${RuleKeys.toVector.sorted.mkString(", ")})")
      else
        for {
          op <- field(o, "op") match {
            case Some(JsString(s)) if Ops.contains(s) => Right(s)
            case _                                    => Left(s"op must be one of ${Ops.mkString(", ")}")
          }
          _ <- checkValues(o, op)
          _ <- field(o, "tone") match {
            case Some(JsString(s)) if Tones.contains(s) => Right(())
            case _                                      => Left(s"tone must be one of ${Tones.mkString(", ")}")
          }
          _ <- checkLabel(o)
          _ <- checkTableFields(kind, o)
        } yield ()
    case _ => Left("rule must be an object")
  }

  private def finite(v: Option[JsValue]): Option[BigDecimal] = v.collect { case JsNumber(n) => n }

  private def checkValues(o: JsObject, op: String): Either[String, Unit] = {
    val value = field(o, "value")
    if (NumericOps.contains(op)) {
      finite(value) match {
        case None => Left("value must be a finite number")
        case Some(lo) =>
          if (op == "between") field(o, "value2") match {
            case None => Left("value2 is required for between")
            case Some(JsNumber(hi)) => if (lo <= hi) Right(()) else Left("value must be <= value2 for between")
            case Some(_) => Left("value2 must be a finite number")
          }
          else if (field(o, "value2").isDefined) Left("value2 is only allowed for between")
          else Right(())
      }
    } else {
      val textual = value match {
        case Some(JsNumber(_))                                              => true
        case Some(JsString(s)) if s.trim.nonEmpty && s.trim.length <= MaxText => true
        case _                                                              => false
      }
      if (!textual) Left(s"value must be a finite number or a non-blank text of at most $MaxText characters")
      else if (field(o, "value2").isDefined) Left("value2 is only allowed for between")
      else Right(())
    }
  }

  private def checkLabel(o: JsObject): Either[String, Unit] = field(o, "label") match {
    case None => Right(())
    case Some(JsString(s)) if s.trim.nonEmpty && s.trim.length <= MaxLabel => Right(())
    case Some(_) => Left(s"label must be a text of 1 to $MaxLabel characters")
  }

  private def checkTableFields(kind: OutputKind, o: JsObject): Either[String, Unit] =
    if (kind == OutputKind.Table) {
      val columnOk = field(o, "column") match {
        case Some(JsString(s)) if s.trim.nonEmpty => true
        case _                                    => false
      }
      if (!columnOk) Left("column is required (a non-empty column name) on a table rule")
      else
        field(o, "target") match {
          case None                                     => Right(())
          case Some(JsString(t)) if Targets.contains(t) => Right(())
          case Some(_)                                  => Left("target must be cell or row")
        }
    } else if (field(o, "column").isDefined) Left(s"column is only allowed on table rules")
    else if (field(o, "target").isDefined) Left(s"target is only allowed on table rules")
    else Right(())
}
