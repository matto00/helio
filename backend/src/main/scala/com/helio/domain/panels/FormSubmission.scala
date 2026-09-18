package com.helio.domain.panels

import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.engine.DatasetRowValidator.FieldError
import com.helio.domain.model.DatasetFieldDeclaration
import spray.json._

/** HEL-1087 design.md D3: pure, side-effect-free builder for a `form` panel's submit path — the
 *  server-side mirror of the client's own tightening rules, run under the bound source's lock
 *  (`DataSourceRepository.appendBuiltRow`), never before it, so a concurrent declaration change
 *  can never be raced. Every rule below is evaluated per field, first match wins, and every
 *  failure across every field is collected before returning (never short-circuiting on the
 *  first). */
object FormSubmission {

  /** A `JsString` that is empty or all-whitespace is treated as not supplied (the client's
   *  `isEmptyValue` rule, design.md D3 step iv) — the API never accepts what the browser blocks,
   *  never stores a blank. An explicit `JsNull` is likewise not-supplied (equivalent to the key
   *  being absent entirely). Any other value (including `false`/`0`/an empty array) is a real,
   *  supplied value. */
  private def isEmptyValue(v: JsValue): Boolean = v match {
    case JsNull                          => true
    case JsString(s) if s.trim.isEmpty   => true
    case _                                => false
  }

  /** Builds one positional row from `values` (the wire's `{"<sourceField>": <value>}` map),
   *  validating it against both the form's own rules (`config`) and the dataset's declared schema
   *  (`declaration`) — design.md D3 (i)-(viii). `Left` with every collected `FieldError` on any
   *  failure; `Right` with the row to persist (default-filled per `DatasetRowValidator`) on
   *  success. Never partially builds a row: a `Left` here means `DataSourceRepository
   *  .appendBuiltRow` writes nothing (D3, C8). */
  def buildRow(
      config:      FormPanelConfig,
      declaration: Vector[DatasetFieldDeclaration],
      values:      Map[String, JsValue]
  ): Either[Vector[FieldError], Vector[JsValue]] = {
    val declaredByName  = declaration.map(f => f.name -> f).toMap
    val configuredNames = config.fields.map(_.sourceField).toSet

    // (i) a key in `values` that names no configured field at all.
    val unconfiguredErrors: Vector[FieldError] =
      values.keySet.diff(configuredNames).toVector.sorted.map(k => FieldError(k, "not part of this form"))

    // Per configured field: `Left` on any rule violation; `Right(Some(name -> value))` to write;
    // `Right(None)` to leave positionally absent (optional-and-unsupplied, or an
    // unsupplied-optional-undeclared field ignored outright per (iii)).
    val perField: Vector[Either[FieldError, Option[(String, JsValue)]]] = config.fields.map { field =>
      val suppliedRaw     = values.get(field.sourceField)
      val supplied         = suppliedRaw.filterNot(isEmptyValue)
      val configRequired   = field.required.contains(true)

      declaredByName.get(field.sourceField) match {
        case None =>
          // (iii) — undeclared configured field: rejected when a value IS supplied, or when the
          // form marks it required (this reason wins over "required" — the field is skipped by
          // every rule below). An unsupplied OPTIONAL undeclared field is ignored: nothing was
          // entered, so nothing is dropped.
          if (supplied.isDefined || configRequired)
            Left(FieldError(field.sourceField, "not declared by the bound dataset"))
          else
            Right(None)
        case Some(declared) =>
          // (ii) — a value for a `file` control is never accepted (HEL-1086).
          if (field.control == "file" && supplied.isDefined) {
            Left(FieldError(field.sourceField, "file fields are not yet supported"))
          } else {
            val required = configRequired || declared.required
            if (supplied.isEmpty) {
              // (v) — required (form OR declared) with no supplied value: rejected, with NO
              // declared-default fill (the client blocks it, so the server must too). An optional
              // field left unsupplied is positionally absent below and takes the declared
              // default/`JsNull` via `DatasetRowValidator`.
              if (required) Left(FieldError(field.sourceField, "required"))
              else Right(None)
            } else {
              val value = supplied.get
              // (vi) — a `select`'s options must be a non-empty JSON array; when they are not,
              // EVERY supplied value is rejected rather than the membership check being skipped.
              if (field.control == "select") {
                field.options match {
                  case Some(JsArray(opts)) if opts.nonEmpty =>
                    if (opts.contains(value)) Right(Some(field.sourceField -> value))
                    else Left(FieldError(field.sourceField, "not one of the configured options"))
                  case _ =>
                    Left(FieldError(field.sourceField, "options are not configured"))
                }
              } else {
                Right(Some(field.sourceField -> value))
              }
            }
          }
      }
    }

    val fieldErrors = perField.collect { case Left(e) => e }
    val allErrors    = unconfiguredErrors ++ fieldErrors

    if (allErrors.nonEmpty) {
      Left(allErrors)
    } else {
      val suppliedByName = perField.collect { case Right(Some((n, v))) => n -> v }.toMap

      // (vii) — the positional row, in DECLARED order: `JsNull` for both an unsupplied configured
      // field and a field the form never configures at all — either way, the declared default (or
      // requirement) applies via step (viii) below.
      val row = declaration.map(f => suppliedByName.getOrElse(f.name, JsNull))

      // (viii) — the EFFECTIVE declaration: a configured field the form marks `required: true` is
      // copied with `required = true, default = None` (the "no declared-default fill" rule from
      // (v), enforced again here since `DatasetRowValidator` is the one actually filling
      // defaults for a `JsNull` cell).
      val formRequiredNames = config.fields.collect { case f if f.required.contains(true) => f.sourceField }.toSet
      val effectiveDeclaration = declaration.map { f =>
        if (formRequiredNames.contains(f.name)) f.copy(required = true, default = None) else f
      }

      DatasetRowValidator.validateRowStructured(effectiveDeclaration, row) match {
        case Left(DatasetRowValidator.RowFieldFailures(errors)) => Left(errors)
        case Left(DatasetRowValidator.RowLengthFailure(expected, actual)) =>
          // Unreachable in practice — `row` is built to exactly `declaration.size` above — but
          // handled explicitly rather than left as a `MatchError` so a future change to either
          // side fails loud rather than crashing the request.
          Left(Vector(FieldError("row", s"expected $expected fields, got $actual")))
        case Right(validated) => Right(validated)
      }
    }
  }
}
