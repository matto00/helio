package com.helio.services.sources

import com.helio.domain.engine.PipelineRowJson.Row
import spray.json._

/** HEL-1628 design.md D6: lossless wire encoding of engine rows for the client evaluator. Mirrors the
 *  parity corpus encoding (`evaluator/wire.ts` is the decoder): Int -> `{"$int": n}`, Long -> `{"$long": "n"}`,
 *  NaN / +-Infinity / negative zero -> `{"$double": "..."}`, every other number a plain JSON number (a double).
 *
 *  A value the encoder does not recognise (a nested map, a value class the engine never produces for a
 *  sampleable kind) is a server bug: it throws [[SampleRowJson.UnsupportedValue]], naming only the JVM class --
 *  never the value, since a cell may be user data. There is deliberately no `toString` fallback. */
object SampleRowJson {

  final class UnsupportedValue(val className: String)
      extends RuntimeException(s"Cannot encode a sample cell of type $className")

  def encodeValue(v: Any): JsValue = v match {
    case null       => JsNull
    case b: Boolean => JsBoolean(b)
    case i: Int     => JsObject("$int" -> JsNumber(i))
    case l: Long    => JsObject("$long" -> JsString(l.toString))
    case s: String  => JsString(s)
    case d: Double =>
      if (d.isNaN) JsObject("$double" -> JsString("NaN"))
      else if (d.isPosInfinity) JsObject("$double" -> JsString("Infinity"))
      else if (d.isNegInfinity) JsObject("$double" -> JsString("-Infinity"))
      else if (d == 0.0 && 1 / d < 0) JsObject("$double" -> JsString("-0.0"))
      else JsNumber(d)
    case other => throw new UnsupportedValue(other.getClass.getName)
  }

  def encode(row: Row): JsObject = JsObject(row.map { case (k, v) => k -> encodeValue(v) })
}
