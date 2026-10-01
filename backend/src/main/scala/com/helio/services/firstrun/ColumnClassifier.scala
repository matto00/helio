package com.helio.services.firstrun

import com.helio.domain.steps.DateBucketStep

import scala.collection.mutable
import scala.util.Try

sealed trait ColumnKind
object ColumnKind {
  case object Numeric     extends ColumnKind
  case object DateLike    extends ColumnKind
  case object Categorical extends ColumnKind
  case object Text        extends ColumnKind
}

/** @param distinctDates number of distinct calendar days in the sample; only meaningful for
 *                       [[ColumnKind.DateLike]] (drives the day/month granularity choice). */
final case class ClassifiedColumn(name: String, kind: ColumnKind, distinctDates: Int = 0)

/** Rule-based column typing for the first-run builder (HEL-1209).
 *
 *  CSV columns materialize as strings, so the builder cannot read types off the schema; it samples
 *  rows and applies a fixed, deterministic rule. Order matters: numeric is tested BEFORE date-like,
 *  so an epoch-numeric column stays numeric (datebucket would accept epoch longs, but a first-run
 *  chart over raw epochs is not what a user dropping a CSV expects).
 *
 *   - numeric: >= 90% of non-blank cells match a plain decimal/scientific literal. Deliberately
 *     NOT lenient about thousands separators, currency symbols or `%`: the `cast` step the
 *     builder emits uses `String.toDouble`, which turns those into null, so classifying them
 *     numeric would produce an all-null column. They fall through to categorical/text.
 *   - date-like: not numeric, and >= 90% of non-blank cells are accepted by
 *     [[DateBucketStep.parseNonEpochDate]] (the datebucket step's own non-epoch parser). Non-ISO
 *     formats such as MM/dd/yyyy are therefore NOT date-like.
 *   - categorical: neither, with 2..max(20, 50% of sampled rows) distinct values.
 *   - text: everything else. */
object ColumnClassifier {

  val SampleRows: Int       = 200
  private val Threshold      = 0.9
  private val MaxCategories  = 20
  private val NumericLiteral = """^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""".r

  def classify(headers: Vector[String], rows: Vector[Vector[String]]): Vector[ClassifiedColumn] = {
    val seen = mutable.Set.empty[String]
    headers.zipWithIndex.collect {
      case (name, idx) if name.trim.nonEmpty && seen.add(name) =>
        classifyColumn(name, rows.map(_.lift(idx).getOrElse("").trim), rows.size)
    }
  }

  private def classifyColumn(name: String, cells: Vector[String], sampledRows: Int): ClassifiedColumn = {
    val nonBlank = cells.filter(_.nonEmpty)
    if (nonBlank.isEmpty) ClassifiedColumn(name, ColumnKind.Text)
    else if (fraction(nonBlank)(isNumeric) >= Threshold) ClassifiedColumn(name, ColumnKind.Numeric)
    else {
      val dates = nonBlank.flatMap(DateBucketStep.parseNonEpochDate)
      if (dates.size.toDouble / nonBlank.size >= Threshold)
        ClassifiedColumn(name, ColumnKind.DateLike, distinctDates = dates.distinct.size)
      else {
        val distinct = nonBlank.distinct.size
        val kind =
          if (distinct >= 2 && distinct <= math.max(MaxCategories, sampledRows / 2)) ColumnKind.Categorical
          else ColumnKind.Text
        ClassifiedColumn(name, kind)
      }
    }
  }

  private def fraction(cells: Vector[String])(p: String => Boolean): Double =
    cells.count(p).toDouble / cells.size

  private[firstrun] def isNumeric(cell: String): Boolean =
    NumericLiteral.matches(cell) && Try(cell.toDouble).toOption.exists(d => !d.isNaN && !d.isInfinite)
}
