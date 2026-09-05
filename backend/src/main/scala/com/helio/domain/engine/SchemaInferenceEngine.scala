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
      // HEL-868: padTo already treats a short/ragged row's missing trailing cells as empty, and
      // the fold below marks an empty cell nullable -- so CSV already honours absence as
      // evidence of nullability, with no code change needed here. It also conflates "empty" with
      // "absent" (both pad/parse to `""`), a divergence from JSON's three-way distinction that is
      // retained deliberately (design D3/D4): CSV has no on-the-wire encoding for the difference.
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
  // that path (`None` until the first non-null value arrives), plus `presentNonNullCount` -- the
  // number of sampled objects that supplied a present, non-null value at this path.
  //
  // HEL-868 design D1/D2: nullability is derived at projection time as
  // `presentNonNullCount < objects.size`, a single composed rule that treats absence and an
  // explicit `JsNull` leaf identically -- both simply fail to increment the count. This replaces
  // HEL-858's "design D2 -- absence never contributes" boolean, which is now the codified defect:
  // a path unioned in from a minority of sampled objects was advertised non-nullable. A count
  // compared against a constant total is order-independent by construction (addition commutes).
  private case class PathAcc(dataType: Option[DataFieldType], presentNonNullCount: Int)

  private def inferFromObjects(objects: Seq[JsObject]): Seq[InferredField] = {
    val accByPath = objects.foldLeft(Map.empty[String, PathAcc]) { (acc, obj) =>
      JsonFlattener.leaves(obj).foldLeft(acc) { case (m, (path, value)) =>
        val prior = m.getOrElse(path, PathAcc(None, presentNonNullCount = 0))
        value match {
          case JsNull =>
            // design D3 (unchanged): JsNull never participates in the widening join -- a path
            // seen as null in one object and numeric in another still infers as the numeric type
            // (design D7), not StringType. HEL-868: it also increments nothing, so it makes the
            // path nullable by the same arithmetic as absence does.
            m.updated(path, prior)
          case other =>
            val (valueType, _) = inferJsonType(other)
            val widened = prior.dataType match {
              case None       => valueType
              case Some(seen) => widenJson(seen, valueType)
            }
            m.updated(path, PathAcc(Some(widened), prior.presentNonNullCount + 1))
        }
      }
    }
    // design D4: `leaves` sorts per object, but the union spans many objects, so re-sort the
    // merged path set globally for a stable, order-independent field sequence.
    accByPath.toSeq.sortBy(_._1).map { case (path, PathAcc(dataTypeOpt, presentNonNullCount)) =>
      // A path that was only ever seen as JsNull (dataTypeOpt empty) infers StringType, matching
      // inferJsonType(JsNull) and the "all-null path is a nullable string" spec scenario.
      val nullable = presentNonNullCount < objects.size
      InferredField(path, displayName(path), dataTypeOpt.getOrElse(DataFieldType.StringType), nullable)
    }
  }

  // HEL-891 design D2/D8: a SHALLOW union across the TOP-LEVEL keys of each `JsObject` in
  // `objects`, sharing `inferFromObjects`'s type lattice (`inferJsonType`/`widenJson`) but
  // deliberately NOT calling `JsonFlattener.leaves` -- pipeline-output rows are already-projected
  // columns stored un-flattened (design D2), so flattening here would describe a schema whose
  // dotted keys the stored rows do not have. Also does not compute nullability (design D3) --
  // the pipeline-output caller pins its own `nullable = true` policy, unrelated to this engine's
  // absence-never-contributes rule.
  def inferShallowFromJsObjects(objects: Vector[JsObject]): Seq[InferredField] = {
    val accByKey = objects.foldLeft(Map.empty[String, Option[DataFieldType]]) { (acc, obj) =>
      obj.fields.foldLeft(acc) { case (m, (key, value)) =>
        val prior = m.getOrElse(key, None)
        value match {
          case JsNull =>
            // design D8: an explicit JsNull MUST be branched on FIRST and contributes NOTHING
            // to the type join. inferJsonType(JsNull) returns StringType, and folding that
            // through widenJson against a numeric accumulator would hit the catch-all and
            // widen the WHOLE column to string -- one null cell anywhere would poison it.
            // Leave the accumulator exactly as it was.
            m.updated(key, prior)
          case other =>
            val (valueType, _) = inferJsonType(other)
            val widened = prior match {
              case None       => valueType
              case Some(seen) => widenJson(seen, valueType)
            }
            m.updated(key, Some(widened))
        }
      }
    }
    // Sort the merged key set globally for order-independence, matching inferFromObjects.
    accByKey.toSeq.sortBy(_._1).map { case (key, dataTypeOpt) =>
      // design D6: every key in the union MUST appear, including one that was JsNull (or absent
      // from every object it appeared with a non-null value) -- falls back to StringType,
      // matching inferJsonType(JsNull) and today's inferFieldType(null) => "string".
      InferredField(key, displayName(key), dataTypeOpt.getOrElse(DataFieldType.StringType), nullable = false)
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
