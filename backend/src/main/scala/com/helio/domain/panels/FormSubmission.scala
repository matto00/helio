package com.helio.domain.panels

import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.engine.DatasetRowValidator.FieldError
import com.helio.domain.model.DatasetFieldDeclaration
import spray.json._

import java.time.Instant

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

  /** HEL-1086 design.md D2: validates a `file` control's supplied value — either the
   *  presence-marker placeholder `PanelService.submitForm` folds in before the pre-lock check, or
   *  the real `binary-ref` object substituted in before the final in-lock check (both carry
   *  `filename`/`sizeBytes`, so the same check applies to either shape) — against
   *  `FormUploadConfig`'s extension allowlist and size bound. Never touches file bytes. */
  private def validateFilePlaceholder(value: JsValue): Either[String, Unit] = value match {
    case obj: JsObject =>
      obj.fields.get("filename") match {
        case Some(JsString(filename)) =>
          val sizeBytes = obj.fields.get("sizeBytes").collect { case JsNumber(n) => n.toLong }.getOrElse(Long.MaxValue)
          FormUploadConfig.validate(filename, sizeBytes)
        case _ => Left("missing filename")
      }
    case _ => Left("not a file value")
  }

  /** Builds one positional row from `values` (the wire's `{"<sourceField>": <value>}` map),
   *  validating it against both the form's own rules (`config`) and the dataset's declared schema
   *  (`declaration`) — design.md D3 (i)-(viii). `Left` with every collected `FieldError` on any
   *  failure; `Right` with the row to persist (default-filled per `DatasetRowValidator`) on
   *  success. Never partially builds a row: a `Left` here means `DataSourceRepository
   *  .appendBuiltRow` writes nothing (D3, C8). */
  /** `now` (HEL-1089 design.md Decision 1/3a): the server-assigned instant injected into a
   *  counter-configured submission's `occurred_at` cell — defaulted to `Instant.now()` so every
   *  pre-existing non-counter caller/test is unaffected, but always caller-suppliable so a test
   *  can freeze it (tasks.md 2.3's millisecond-collision scenario). Never read from `values` —
   *  a client-supplied `occurred_at` is discarded outright (D3a). */
  def buildRow(
      config:      FormPanelConfig,
      declaration: Vector[DatasetFieldDeclaration],
      values:      Map[String, JsValue],
      now:         Instant = Instant.now()
  ): Either[Vector[FieldError], Vector[JsValue]] = {
    val declaredByName  = declaration.map(f => f.name -> f).toMap
    val configuredNames = config.fields.map(_.sourceField).toSet
    val hasCounterField = config.fields.exists(_.control == "counter")

    // HEL-1089 design.md Decision 3a: `occurred_at`/`value` are convention-named declared fields
    // injected by this method, never configured form fields — so a key by either literal name is
    // excluded from the "unconfigured" rejection below when a counter field is present. This is
    // what makes a spoofed `values("occurred_at")` merely IGNORED (spec scenario) rather than a
    // submission-rejecting field error.
    val injectedKeys = if (hasCounterField) Set("occurred_at", "value") else Set.empty[String]

    // (i) a key in `values` that names no configured field at all.
    val unconfiguredErrors: Vector[FieldError] =
      values.keySet.diff(configuredNames).diff(injectedKeys).toVector.sorted.map(k => FieldError(k, "not part of this form"))

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
          // HEL-1089 design.md spec (form-panel-submit) — a `counter` field's `delta` is ALWAYS
          // required, zero included (a no-op click is still an event): its requiredness is never
          // gated on `field.required`/`declared.required` the way every other control is.
          val required = configRequired || declared.required || field.control == "counter"
          if (supplied.isEmpty) {
            // (v) — required (form OR declared) with no supplied value: rejected, with NO
            // declared-default fill (the client blocks it, so the server must too). An optional
            // field left unsupplied is positionally absent below and takes the declared
            // default/`JsNull` via `DatasetRowValidator`.
            if (required) Left(FieldError(field.sourceField, "required"))
            else Right(None)
          } else {
            val value = supplied.get
            // (ii) — HEL-1086: a `file` control's supplied value is a placeholder/real
            // `binary-ref` JSON object (`{"filename", "sizeBytes", ...}`, design.md D2) — its
            // extension and size are validated against `FormUploadConfig` here, exactly like any
            // other field-level rule; no bytes are ever touched by this pure builder.
            if (field.control == "file") {
              validateFilePlaceholder(value) match {
                case Left(_)  => Left(FieldError(field.sourceField, "invalid"))
                case Right(_) => Right(Some(field.sourceField -> value))
              }
            } else if (field.control == "counter") {
              // HEL-1089 design.md Decision 1 — a counter field's submitted value is a signed
              // `delta`; any non-number shape is rejected before a row is ever built (D3, C8).
              value match {
                case n: JsNumber => Right(Some(field.sourceField -> n))
                case _            => Left(FieldError(field.sourceField, "number is required"))
              }
            } else if (field.control == "select") {
              // (vi) — a `select`'s options must be a non-empty JSON array; when they are not,
              // EVERY supplied value is rejected rather than the membership check being skipped.
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

    val fieldErrors = perField.collect { case Left(e) => e }
    val allErrors    = unconfiguredErrors ++ fieldErrors

    if (allErrors.nonEmpty) {
      Left(allErrors)
    } else {
      val configuredByName = perField.collect { case Right(Some((n, v))) => n -> v }.toMap

      // HEL-1089 design.md Decision 3a — for a counter-configured submission, inject the
      // server-assigned `occurred_at` (never the client's, D3) and pass through whatever `value`
      // (if anything) the client sent, for any declared field literally named that way. Both
      // bypass the ordinary "configured field" path entirely — neither is ever a `FormFieldSpec`.
      val injectedByName: Map[String, JsValue] =
        if (!hasCounterField) Map.empty
        else Vector(
          declaredByName.get("occurred_at").map(_ => "occurred_at" -> (JsString(now.toString): JsValue)),
          declaredByName.get("value").map(_ => "value" -> values.getOrElse("value", JsNull))
        ).flatten.toMap

      val suppliedByName = configuredByName ++ injectedByName

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
