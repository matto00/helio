package com.helio.domain.engine

import java.nio.file.{Files, Path, Paths}

/** HEL-1581: the shared parity corpus (`shared-test-fixtures/pipeline-step-parity/`), as the Scala oracle reads and,
 *  in regeneration mode, writes it. Both runners (this one and the frontend Jest runner) use the same value encoding:
 *
 *   - `{"$int": n}` and `{"$long": "n"}` encode integrals (JVM `Int` / `Long`);
 *   - `{"$double": "NaN" | "Infinity" | "-Infinity" | "-0.0"}` encodes the doubles JSON cannot carry;
 *   - every other JSON number is a `Double` (what `PipelineRowJson.jsValueToAny` produces).
 *
 *  Values compare by value AND class, in both directions: an `Int` where the vector holds a plain double fails, and so
 *  does the reverse. */
object ParityCorpus {

  type Row = Map[String, Any]

  val Dir: Path = Paths.get("../shared-test-fixtures/pipeline-step-parity")

  def read(name: String): OJ = OJ.parse(Files.readString(Dir.resolve(name)))

  def write(name: String, json: OJ): Unit = Files.writeString(Dir.resolve(name), OJ.render(json) + "\n")

  // ── value encoding ────────────────────────────────────────────────────────────────────────────────────────────

  def decodeValue(v: OJ): Any = v match {
    case OJ.Null    => null
    case OJ.Bool(b) => b
    case OJ.Num(t)  => t.toDouble
    case OJ.Str(s)  => s
    case OJ.Obj(fields) =>
      fields match {
        case Vector(("$int", OJ.Num(n)))    => n.toInt
        case Vector(("$long", OJ.Str(s)))   => s.toLong
        case Vector(("$double", OJ.Str(s))) =>
          s match {
            case "NaN"       => Double.NaN
            case "Infinity"  => Double.PositiveInfinity
            case "-Infinity" => Double.NegativeInfinity
            case "-0.0"      => -0.0
            case other       => throw new IllegalArgumentException(s"Unknown double encoding: $other")
          }
        case other => throw new IllegalArgumentException(s"Unsupported object value in a vector: $other")
      }
    case other => throw new IllegalArgumentException(s"Unsupported value in a vector: $other")
  }

  def encodeValue(v: Any): OJ = v match {
    case null       => OJ.Null
    case b: Boolean => OJ.Bool(b)
    case i: Int     => OJ.Obj(Vector("$int" -> OJ.Num(i.toString)))
    case l: Long    => OJ.Obj(Vector("$long" -> OJ.Str(l.toString)))
    case s: String  => OJ.Str(s)
    case d: Double =>
      if (d.isNaN) OJ.Obj(Vector("$double" -> OJ.Str("NaN")))
      else if (d.isPosInfinity) OJ.Obj(Vector("$double" -> OJ.Str("Infinity")))
      else if (d.isNegInfinity) OJ.Obj(Vector("$double" -> OJ.Str("-Infinity")))
      else if (d == 0.0 && 1 / d < 0) OJ.Obj(Vector("$double" -> OJ.Str("-0.0")))
      else OJ.Num(java.lang.Double.toString(d))
    case other => throw new IllegalArgumentException(s"Cannot encode ${other.getClass.getName} into the corpus")
  }

  def decodeRow(v: OJ): Row = v match {
    case OJ.Obj(fields) => fields.map { case (k, x) => k -> decodeValue(x) }.toMap
    case other          => throw new IllegalArgumentException(s"Expected a row object, got $other")
  }

  def decodeRows(v: OJ): Vector[Row] = v match {
    case OJ.Arr(items) => items.map(decodeRow)
    case other         => throw new IllegalArgumentException(s"Expected an array of rows, got $other")
  }

  /** Keys sorted, so a regenerated file is stable (column order is not compared). */
  def encodeRow(row: Row): OJ = OJ.Obj(row.toVector.sortBy(_._1).map { case (k, v) => k -> encodeValue(v) })

  def encodeRows(rows: Seq[Row]): OJ = OJ.Arr(rows.map(encodeRow).toVector)

  // ── comparison ────────────────────────────────────────────────────────────────────────────────────────────────

  private def className(v: Any): String = v match {
    case null       => "null"
    case _: Boolean => "boolean"
    case _: Int     => "int"
    case _: Long    => "long"
    case _: Double  => "double"
    case _: String  => "string"
    case other      => other.getClass.getName
  }

  def valuesEqual(actual: Any, expected: Any): Boolean =
    className(actual) == className(expected) && ((actual, expected) match {
      case (a: Double, e: Double) => java.lang.Double.doubleToLongBits(a) == java.lang.Double.doubleToLongBits(e)
      case (a, e)                 => a == e
    })

  private def rowsEqual(a: Row, e: Row): Boolean =
    a.keySet == e.keySet && a.forall { case (k, v) => valuesEqual(v, e(k)) }

  /** `None` when the frames are equal (row order matters, column order does not); otherwise what differs. */
  def diff(actual: Seq[Row], expected: Seq[Row]): Option[String] =
    if (actual.size != expected.size)
      Some(s"row count ${actual.size} != expected ${expected.size}\n  actual:   ${OJ.compact(encodeRows(actual))}\n  expected: ${OJ.compact(encodeRows(expected))}")
    else
      actual.zip(expected).zipWithIndex.collectFirst {
        case ((a, e), i) if !rowsEqual(a, e) =>
          s"row $i differs\n  actual:   ${OJ.compact(encodeRow(a))}\n  expected: ${OJ.compact(encodeRow(e))}"
      }
}
