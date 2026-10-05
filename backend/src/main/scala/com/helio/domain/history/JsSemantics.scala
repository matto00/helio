package com.helio.domain.history

import spray.json._

import java.lang.{Double => JDouble}
import java.math.{BigDecimal => JBigDecimal, BigInteger}
import scala.util.matching.Regex

/** Ports of the two JavaScript behaviours `frontend/src/utils/aggregate.ts` depends on, so the
 *  backend summary agrees with the frontend on the same cells. Deliberately NOT Scala's
 *  `toDoubleOption`: Java's grammar accepts `"1d"`, `"1f"`, `"0x1p3"` and rejects `"0x10"`,
 *  `"0b11"`, `"0o7"`, which is the opposite of JS `Number(string)`. */
object JsSemantics {

  private val JsWhitespace: Set[Char] =
    Set('\t', '\n', '\u000B', '\f', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿') ++
      (' ' to ' ')

  /** `String.prototype.trim`'s whitespace set (Java's `trim`/`strip` differ from it). */
  def jsTrim(s: String): String = {
    val start = s.indexWhere(c => !JsWhitespace(c))
    if (start < 0) "" else s.substring(start, s.lastIndexWhere(c => !JsWhitespace(c)) + 1)
  }

  private val Hex: Regex     = "^0[xX]([0-9a-fA-F]+)$".r
  private val Binary: Regex  = "^0[bB]([01]+)$".r
  private val Octal: Regex   = "^0[oO]([0-7]+)$".r
  private val Decimal: Regex = "^[+-]?(Infinity|((\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?))$".r

  /** JS `Number(trimmed)` for a non-empty trimmed string; non-finite results are returned as-is. */
  private def stringToNumber(t: String): Option[Double] = t match {
    case Hex(d)    => Some(new BigInteger(d, 16).doubleValue())
    case Binary(d) => Some(new BigInteger(d, 2).doubleValue())
    case Octal(d)  => Some(new BigInteger(d, 8).doubleValue())
    case Decimal(_, _*) =>
      if (t.endsWith("Infinity")) Some(if (t.startsWith("-")) Double.NegativeInfinity else Double.PositiveInfinity)
      else Some(JDouble.parseDouble(t))
    case _ => None
  }

  /** Port of aggregate.ts `coerceNumber`: a finite number, or `None`. Booleans, nulls, arrays,
   *  objects and blank strings are not coercible. */
  def coerceNumber(v: JsValue): Option[Double] = v match {
    case JsNumber(n) => Some(n.toDouble).filter(isFinite)
    case JsString(s) =>
      val t = jsTrim(s)
      if (t.isEmpty) None else stringToNumber(t).filter(isFinite)
    case _ => None
  }

  def isFinite(d: Double): Boolean = !d.isNaN && !d.isInfinity

  /** Port of JS `String(cell)` for a possibly-absent cell, as used for `groupAndAggregate`'s
   *  group key. Arrays comma-join with null elements empty; objects are `[object Object]`. */
  def jsString(cell: Option[JsValue]): String = cell match {
    case None    => "undefined"
    case Some(v) => jsString(v)
  }

  def jsString(v: JsValue): String = v match {
    case JsString(s)  => s
    case JsNumber(n)  => numberToString(n.toDouble)
    case JsTrue       => "true"
    case JsFalse      => "false"
    case JsNull       => "null"
    case JsArray(els) => els.map { case JsNull => ""; case e => jsString(e) }.mkString(",")
    case _: JsObject  => "[object Object]"
  }

  /** ECMAScript `Number::toString` (radix 10). Not `Double.toString` and not the exact integer
   *  value: `2^63` is `"9223372036854776000"` and `1e21` is `"1e+21"`. */
  def numberToString(d: Double): String =
    if (d.isNaN) "NaN"
    else if (d == 0.0) "0"
    else if (d.isInfinity) { if (d > 0) "Infinity" else "-Infinity" }
    else if (d < 0) "-" + numberToString(-d)
    else {
      val (digits, n) = shortestDigits(d)
      formatDigits(digits, n)
    }

  /** `d = 0.digits x 10^n` with the fewest digits that round-trip. JDK 21's `Double.toString` is
   *  shortest except for some subnormals (`4.9E-324` where JS prints `5e-324`), so a two-digit
   *  result is re-tested against the two neighbouring one-digit decimals and the one CLOSEST to
   *  the exact value wins (ES: minimal digit count first, then closest). */
  private def shortestDigits(d: Double): (String, Int) = {
    val bd     = new JBigDecimal(JDouble.toString(d)).stripTrailingZeros()
    val digits = bd.unscaledValue().toString
    val n      = digits.length - bd.scale()
    if (digits.length != 2) (digits, n)
    else {
      val exact = new JBigDecimal(d)
      val lead  = digits.head.asDigit
      val candidates = Seq(lead, lead + 1).map(c => new JBigDecimal(BigInteger.valueOf(c.toLong), -(n - 1)))
      val valid = candidates.filter(c => c.doubleValue() == d)
      if (valid.isEmpty) (digits, n)
      else {
        val best = valid.minBy(c => c.subtract(exact).abs())
        val s    = best.stripTrailingZeros()
        (s.unscaledValue().toString, s.unscaledValue().toString.length - s.scale())
      }
    }
  }

  private def formatDigits(s: String, n: Int): String = {
    val k = s.length
    if (k <= n && n <= 21) s + "0" * (n - k)
    else if (0 < n && n <= 21) s.take(n) + "." + s.drop(n)
    else if (-6 < n && n <= 0) "0." + "0" * (-n) + s
    else {
      val e    = n - 1
      val sign = if (e < 0) "-" else "+"
      val mant = if (k == 1) s else s.head.toString + "." + s.tail
      mant + "e" + sign + math.abs(e)
    }
  }
}
