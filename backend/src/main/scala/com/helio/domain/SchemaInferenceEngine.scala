package com.helio.domain

import spray.json._

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, LocalDateTime, ZonedDateTime}
import scala.util.Try

object SchemaInferenceEngine {

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  def fromJson(json: JsValue): InferredSchema = json match {
    case JsArray(elements) =>
      val objects = elements.collect { case obj: JsObject => obj }
      val merged  = mergeObjects(objects)
      InferredSchema(flattenObject(merged, prefix = ""))

    case obj: JsObject =>
      InferredSchema(flattenObject(obj, prefix = ""))

    case _ =>
      InferredSchema(Seq.empty)
  }

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

  // ---------------------------------------------------------------------------
  // JSON helpers
  // ---------------------------------------------------------------------------

  private def mergeObjects(objects: Seq[JsObject]): JsObject = {
    val merged = objects.foldLeft(Map.empty[String, JsValue]) { (acc, obj) =>
      obj.fields.foldLeft(acc) { case (m, (k, v)) =>
        m.get(k) match {
          case Some(JsNull) => m.updated(k, v)   // prefer non-null if we have one
          case Some(_)      => m                 // keep first non-null value
          case None         => m.updated(k, v)
        }
      }
    }
    // Mark keys that had nulls in any object
    val withNulls = objects.foldLeft(merged) { (acc, obj) =>
      obj.fields.foldLeft(acc) { case (m, (k, v)) =>
        if (v == JsNull) m.updated(k, JsNull) else m
      }
    }
    JsObject(withNulls)
  }

  private def flattenObject(obj: JsObject, prefix: String): Seq[InferredField] =
    obj.fields.toSeq.sortBy(_._1).flatMap { case (key, value) =>
      val fullKey = if (prefix.isEmpty) key else s"$prefix.$key"
      value match {
        case nested: JsObject =>
          flattenObject(nested, fullKey)
        case _ =>
          val (fieldType, nullable) = inferJsonType(value)
          Seq(InferredField(fullKey, displayName(fullKey), fieldType, nullable))
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

  // ---------------------------------------------------------------------------
  // CSV helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // displayName helpers
  // ---------------------------------------------------------------------------

  private def splitCamel(s: String): Seq[String] =
    s.foldLeft(Vector.empty[String]) { (acc, ch) =>
      if (ch.isUpper && acc.nonEmpty) acc :+ ch.toString
      else if (acc.isEmpty) Vector(ch.toString)
      else acc.init :+ (acc.last + ch)
    }
}
