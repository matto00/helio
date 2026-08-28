package com.helio.domain.engine

import com.helio.domain.model.{DataFieldType, InferredField, InferredSchema}
import spray.json._

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, LocalDateTime, ZonedDateTime}
import scala.util.Try

object SchemaInferenceEngine {

  // Public API

  def fromJson(json: JsValue): InferredSchema = json match {
    case JsArray(elements) =>
      val objects = elements.collect { case obj: JsObject => obj }
      InferredSchema(inferFromObjects(objects))

    case obj: JsObject =>
      // HEL-858 design D1: route the single-object root through the same accumulator as the
      // array case (a one-element sequence) so there is one code path, not two.
      InferredSchema(inferFromObjects(Seq(obj)))

    case _ =>
      InferredSchema(Seq.empty)
  }

  /** Shared "rows in → InferredSchema out" facade (HEL-473): every `ConnectorDriver[Config]`'s `fetch`
   *  returns `Vector[JsValue]` (one `JsObject` per row) — this wraps that row shape into the
   *  `JsArray` `fromJson` expects, so new connectors get correct inference without hand-rolling the
   *  wrap themselves. A thin delegate, not a new inference path: identical output to
   *  `fromJson(JsArray(rows))` for any input. */
  def inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema = fromJson(JsArray(rows))

  def fromCsv(csv: String): InferredSchema = {
    val lines = splitCsvLines(csv)
    if (lines.isEmpty || lines.head.trim.isEmpty) return InferredSchema(Seq.empty)

    val headers = parseRfc4180Row(lines.head)
    if (headers.isEmpty) return InferredSchema(Seq.empty)

    val dataRows = lines.drop(1).take(100)
    if (dataRows.isEmpty)
      return InferredSchema(headers.map(h => InferredField(h, displayName(h), DataFieldType.StringType, nullable = false)))

    // Initialise per-column state: (currentType, isNullable)
    val init: Vector[(DataFieldType, Boolean)] =
      Vector.fill(headers.length)((DataFieldType.IntegerType, false))

    val state = dataRows.foldLeft(init) { (colState, line) =>
      val cells = parseRfc4180Row(line).padTo(headers.length, "")
      colState.zip(cells).map { case ((colType, nullable), cell) =>
        if (cell.isEmpty) (colType, true)
        else (widenType(colType, cell), nullable)
      }
    }

    val fields = headers.zip(state).map { case (name, (colType, nullable)) =>
      InferredField(name, displayName(name), colType, nullable)
    }
    InferredSchema(fields)
  }

  def parseCsvRows(csv: String, maxRows: Int = 10): (Vector[String], Vector[Vector[String]]) = {
    val lines = splitCsvLines(csv)
    if (lines.isEmpty || lines.head.trim.isEmpty) return (Vector.empty, Vector.empty)
    val headers = parseRfc4180Row(lines.head)
    val rows = lines.drop(1).filter(_.nonEmpty).take(maxRows).map(parseRfc4180Row).toVector
    (headers, rows)
  }

  def displayName(name: String): String = {
    // Split on dots first, then on snake_case underscores, then camelCase boundaries
    val parts = name
      .split('.')
      .flatMap(_.split('_'))
      .flatMap(splitCamel)
    parts.map(_.toLowerCase.capitalize).mkString(" ")
  }

  // JSON helpers

  // HEL-858 design D1: flatten each object via the shared `JsonFlattener.leaves` traversal,
  // THEN merge over the resulting dotted paths -- rather than HEL-599's `mergeObjects`, which
  // merged raw objects at the top level BEFORE flattening and could only pick one `JsValue` per
  // key (first-non-null-wins), so a nested subtree from object 0 won its sub-keys wholesale and
  // a column's type was fixed by whichever value happened to be sampled first. Union-over-paths
  // makes recursion fall out structurally -- `leaves` already recurses -- instead of being
  // reimplemented as a second recursive walk with its own depth bound and collision semantics.
  // `mergeObjects` had no other caller (verified by grep) and is deleted, not left dead.
  //
  // Per-path accumulator: the widened `DataFieldType` over all non-null values seen so far at
  // that path (`None` until the first non-null value arrives), and whether any sampled object
  // carried an explicit `JsNull` there (design D2 -- absence never contributes; only an explicit
  // null does).
  private case class PathAcc(dataType: Option[DataFieldType], nullable: Boolean)

  private def inferFromObjects(objects: Seq[JsObject]): Seq[InferredField] = {
    val accByPath = objects.foldLeft(Map.empty[String, PathAcc]) { (acc, obj) =>
      JsonFlattener.leaves(obj).foldLeft(acc) { case (m, (path, value)) =>
        val prior = m.getOrElse(path, PathAcc(None, nullable = false))
        value match {
          case JsNull =>
            // design D3: JsNull contributes nullability only and never participates in the
            // widening join -- a path seen as null in one object and numeric in another still
            // infers as the numeric type (design D7), not StringType.
            m.updated(path, prior.copy(nullable = true))
          case other =>
            val (valueType, _) = inferJsonType(other)
            val widened = prior.dataType match {
              case None       => valueType
              case Some(seen) => widenJson(seen, valueType)
            }
            m.updated(path, prior.copy(dataType = Some(widened)))
        }
      }
    }
    // design D4: `leaves` sorts per object, but the union spans many objects, so re-sort the
    // merged path set globally for a stable, order-independent field sequence.
    accByPath.toSeq.sortBy(_._1).map { case (path, PathAcc(dataTypeOpt, nullable)) =>
      // A path that was only ever seen as JsNull (dataTypeOpt empty) infers StringType, matching
      // inferJsonType(JsNull) and the "all-null path is a nullable string" spec scenario.
      InferredField(path, displayName(path), dataTypeOpt.getOrElse(DataFieldType.StringType), nullable)
    }
  }

  // HEL-858 design D3: the JSON widening join -- a true lattice (commutative, associative,
  // idempotent, StringType at top), deliberately DIVERGING from the CSV path's `widenType`
  // below, which widens a running type against a raw string cell and is order-sensitive (e.g.
  // IntegerType widens to BooleanType on encountering "true"). Copying that order here would
  // type a mixed number/boolean JSON column as boolean and break order-independence, the
  // central acceptance criterion for this ticket -- so JSON gets its own, order-independent
  // join instead of reusing CSV's.
  private def widenJson(a: DataFieldType, b: DataFieldType): DataFieldType = {
    import DataFieldType._
    if (a == b) a
    else
      (a, b) match {
        case (IntegerType, FloatType) | (FloatType, IntegerType)       => FloatType
        case (TimestampType, StringType) | (StringType, TimestampType) => StringType
        case _                                                         => StringType
      }
  }

  private def inferJsonType(value: JsValue): (DataFieldType, Boolean) = value match {
    case JsNull        => (DataFieldType.StringType, true)
    case _: JsBoolean  => (DataFieldType.BooleanType, false)
    case JsNumber(n)   =>
      if (n.scale <= 0 || n.remainder(BigDecimal(1)) == BigDecimal(0))
        (DataFieldType.IntegerType, false)
      else
        (DataFieldType.FloatType, false)
    case JsString(s)   =>
      if (isTimestamp(s)) (DataFieldType.TimestampType, false)
      else (DataFieldType.StringType, false)
    case _             => (DataFieldType.StringType, false) // arrays, objects at leaf
  }

  private def isTimestamp(s: String): Boolean =
    Try(ZonedDateTime.parse(s, DateTimeFormatter.ISO_DATE_TIME)).isSuccess ||
    Try(LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ISO_LOCAL_DATE)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ofPattern("MM/dd/yyyy"))).isSuccess

  // CSV helpers

  private def widenType(current: DataFieldType, value: String): DataFieldType = {
    import DataFieldType._
    current match {
      case IntegerType =>
        if (value.toLongOption.isDefined) IntegerType
        else if (value.toDoubleOption.isDefined) FloatType
        else if (isBooleanValue(value)) BooleanType
        else if (isTimestamp(value)) TimestampType
        else StringType

      case FloatType =>
        if (value.toDoubleOption.isDefined) FloatType
        else if (isBooleanValue(value)) BooleanType
        else if (isTimestamp(value)) TimestampType
        else StringType

      case BooleanType =>
        if (isBooleanValue(value)) BooleanType
        else if (isTimestamp(value)) TimestampType
        else StringType

      case TimestampType =>
        if (isTimestamp(value)) TimestampType
        else StringType

      case StringType => StringType
    }
  }

  private def isBooleanValue(s: String): Boolean =
    s.equalsIgnoreCase("true") || s.equalsIgnoreCase("false")

  private def splitCsvLines(csv: String): Array[String] =
    csv.replace("\r\n", "\n").replace("\r", "\n").split("\n", -1).map(_.stripTrailing())

  private def parseRfc4180Row(line: String): Vector[String] = {
    val fields = scala.collection.mutable.ArrayBuffer.empty[String]
    val buf    = new StringBuilder
    var inQuotes = false
    var i = 0
    while (i < line.length) {
      val ch = line.charAt(i)
      if (inQuotes) {
        if (ch == '"') {
          if (i + 1 < line.length && line.charAt(i + 1) == '"') {
            buf.append('"')
            i += 1
          } else {
            inQuotes = false
          }
        } else {
          buf.append(ch)
        }
      } else {
        ch match {
          case '"' => inQuotes = true
          case ',' =>
            fields += buf.toString.trim
            buf.clear()
          case c => buf.append(c)
        }
      }
      i += 1
    }
    fields += buf.toString.trim
    fields.toVector
  }

  // displayName helpers

  private def splitCamel(s: String): Seq[String] =
    s.foldLeft(Vector.empty[String]) { (acc, ch) =>
      if (ch.isUpper && acc.nonEmpty) acc :+ ch.toString
      else if (acc.isEmpty) Vector(ch.toString)
      else acc.init :+ (acc.last + ch)
    }
}
