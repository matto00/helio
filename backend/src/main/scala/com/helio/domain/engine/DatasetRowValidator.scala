package com.helio.domain.engine

import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import spray.json._

/** HEL-1076 design.md Decision 3: a pure, side-effect-free write-time validator for a `dataset`
 *  source's declared schema. Called from `DataSourceService.createStatic`/`applyStaticRefresh`
 *  today, and from HEL-1077's future row-write API — no service-locator dependency, easy to
 *  unit-test exhaustively. */
object DatasetRowValidator {

  /** A single field-level failure: the field name and a human-readable reason (never a raw
   *  exception message). */
  final case class FieldError(field: String, reason: String)

  /** A single row-level failure not attributable to one field (today: only a too-long row, since
   *  positional alignment can't be trusted past that point). */
  final case class RowLengthError(expected: Int, actual: Int)

  /** One row's validation outcome: either a non-empty list of failures, or the (possibly
   *  default-filled) row to persist. */
  type RowResult = Either[Vector[String], Vector[JsValue]]

  /** Renders one failure into the pinned per-failure message fragment (design.md Decision 7 /
   *  spec.md "Validation failures produce a single pinned error message"), given the 0-based row
   *  index. Callers join fragments across rows with `"; "`. */
  private def renderRowFailures(rowIndex: Int, fieldErrors: Vector[FieldError], rowLengthError: Option[RowLengthError]): Vector[String] =
    rowLengthError match {
      case Some(RowLengthError(expected, actual)) =>
        Vector(s"row $rowIndex: expected $expected fields, got $actual")
      case None =>
        fieldErrors.map { e =>
          if (e.reason == "required") s"row $rowIndex: field '${e.field}' is required"
          else s"row $rowIndex: field '${e.field}' — ${e.reason}"
        }
    }

  /** The JSON "kind" name used in a type-mismatch reason (design.md Decision 3 / spec.md's pinned
   *  `"expected <declaredType>, got <actualKind>"` template) — the JSON value's own kind, never
   *  its Scala runtime type. */
  private def jsonKind(v: JsValue): String = v match {
    case _: JsString  => "string"
    case _: JsNumber  => "number"
    case _: JsBoolean => "boolean"
    case _: JsObject  => "object"
    case _: JsArray   => "array"
    case JsNull       => "null"
  }

  private def isIntegral(n: BigDecimal): Boolean =
    n.scale <= 0 || n.remainder(BigDecimal(1)) == BigDecimal(0)

  /** Validates one non-missing value against a field's declared type, per design.md Decision 3's
   *  exact per-type acceptance rules. `Right(())` on acceptance, `Left(reason)` on rejection —
   *  EVERY rejection (skeptic-final-1.md CR1: code must conform to the pinned template literally,
   *  no bespoke wording per case) uses the single pinned template `"expected <declaredType>, got
   *  <actualKind>"`, where `<actualKind>` is `jsonKind`'s own JSON-kind name of the actual value —
   *  including for a non-integral number given to an `integer` field, or an unparseable string
   *  given to a `timestamp` field: both report `"expected integer, got number"` /
   *  `"expected timestamp, got string"`, exactly like every other mismatch, rather than a
   *  differently-worded explanation. */
  def validateValue(fieldType: DataFieldType, value: JsValue): Either[String, Unit] = {
    val declaredName = DataFieldType.asString(fieldType)
    def reject: Left[String, Unit] = Left(s"expected $declaredName, got ${jsonKind(value)}")

    (fieldType, value) match {
      case (DataFieldType.StringType, _: JsString)     => Right(())
      case (DataFieldType.StringBodyType, _: JsString) => Right(())
      case (DataFieldType.IntegerType, JsNumber(n))     => if (isIntegral(n)) Right(()) else reject
      case (DataFieldType.FloatType, _: JsNumber)       => Right(())
      case (DataFieldType.BooleanType, _: JsBoolean)    => Right(())
      case (DataFieldType.TimestampType, JsString(s))   =>
        if (TimestampParsing.looksLikeTimestamp(s)) Right(()) else reject
      case (DataFieldType.BinaryRefType, _: JsObject)   => Right(())
      case _                                             => reject
    }
  }

  /** Validates a field's `default`, if present, against its own declared type (design.md
   *  Decision 6 / tasks.md 2.3) — same acceptance rules as row validation. `Right(())` when there
   *  is no default or it validates; `Left(FieldError)` using the pinned `"default <reason>"`
   *  format (spec.md's fourth pinned format) otherwise. */
  def validateDefault(field: DatasetFieldDeclaration): Either[FieldError, Unit] =
    field.default match {
      case None => Right(())
      case Some(JsNull) => Right(())
      case Some(v) =>
        validateValue(field.fieldType, v) match {
          case Right(())     => Right(())
          case Left(reason)  => Left(FieldError(field.name, s"default $reason"))
        }
    }

  /** Renders a `validateDefault` failure into the pinned declaration-time message (spec.md
   *  "A declared field's default value must itself satisfy its declared type"):
   *  `"field '<name>' — default <reason>"`. */
  def renderDefaultError(e: FieldError): String = s"field '${e.field}' — ${e.reason}"

  /** Validates every row in `rows` against `declaration`, positionally aligned (design.md
   *  Decision 5). Returns `Left` with every pinned failure message (row-then-field order, joined
   *  by the caller with `"; "`) if any row fails; `Right` with the full set of rows to persist
   *  (missing optional/default-backed fields filled in) otherwise. The WHOLE write is rejected on
   *  any single row's failure — no partial persistence (design.md Decision 4). */
  def validate(
      declaration: Vector[DatasetFieldDeclaration],
      rows:        Vector[Vector[JsValue]]
  ): Either[Vector[String], Vector[Vector[JsValue]]] = {
    val perRow = rows.zipWithIndex.map { case (row, idx) => validateRow(declaration, row, idx) }
    val failures = perRow.zipWithIndex.flatMap {
      case (Left(msgs), _) => msgs
      case (Right(_), _)   => Vector.empty
    }
    if (failures.nonEmpty) Left(failures)
    else Right(perRow.map(_.getOrElse(Vector.empty)))
  }

  private def validateRow(declaration: Vector[DatasetFieldDeclaration], row: Vector[JsValue], rowIndex: Int): RowResult = {
    if (row.size > declaration.size) {
      Left(renderRowFailures(rowIndex, Vector.empty, Some(RowLengthError(declaration.size, row.size))))
    } else {
      val results = declaration.zipWithIndex.map { case (field, i) =>
        val raw     = row.lift(i).getOrElse(JsNull)
        val missing = raw == JsNull
        if (!missing) {
          validateValue(field.fieldType, raw) match {
            case Right(())    => Right(raw)
            case Left(reason) => Left(FieldError(field.name, reason))
          }
        } else {
          field.default match {
            case Some(d) => Right(d)
            case None =>
              if (field.required) Left(FieldError(field.name, "required"))
              else Right(JsNull)
          }
        }
      }
      val errors = results.collect { case Left(e) => e }
      if (errors.nonEmpty) Left(renderRowFailures(rowIndex, errors, None))
      else Right(results.collect { case Right(v) => v })
    }
  }
}
