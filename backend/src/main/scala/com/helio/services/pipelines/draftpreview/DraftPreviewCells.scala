package com.helio.services.pipelines.draftpreview

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.services.sources.SampleRowJson
import spray.json._

/** HEL-1630: the lossless cell codec of the draft-preview wire. Encoding is the source-sample codec
 *  ([[SampleRowJson]]); decoding is its inverse: `{"$int": n}` -> Int, `{"$long": "n"}` -> Long, `{"$double": ".."}` ->
 *  NaN / +-Infinity / -0.0, every other JSON number -> Double. A cell that is none of these (a nested object or array, an
 *  out-of-range `$int`, a malformed `$long`) decodes to `None` so the caller can refuse the request without echoing it. */
object DraftPreviewCells {

  def decodeValue(v: JsValue): Option[Any] = v match {
    case JsNull       => Some(null)
    case JsBoolean(b) => Some(b)
    case JsString(s)  => Some(s)
    case JsNumber(n)  => Some(n.toDouble)
    case JsObject(fields) if fields.size == 1 =>
      fields.head match {
        case ("$int", JsNumber(n)) if n.isValidInt                         => Some(n.toIntExact)
        case ("$long", JsString(s)) if s.matches("^-?[0-9]+$")             => s.toLongOption
        case ("$double", JsString("NaN"))                                  => Some(Double.NaN)
        case ("$double", JsString("Infinity"))                             => Some(Double.PositiveInfinity)
        case ("$double", JsString("-Infinity"))                            => Some(Double.NegativeInfinity)
        case ("$double", JsString("-0.0"))                                 => Some(-0.0)
        case _                                                             => None
      }
    case _ => None
  }

  /** `None` when any cell is not representable; the caller reports the row index only. */
  def decodeRow(obj: JsObject): Option[Row] = {
    val out = Map.newBuilder[String, Any]
    val it  = obj.fields.iterator
    while (it.hasNext) {
      val (k, v) = it.next()
      decodeValue(v) match {
        case Some(cell) => out += (k -> cell)
        case None       => return None
      }
    }
    Some(out.result())
  }

  /** Why a frame cannot be sent back losslessly, or `None` when every cell can. Booleans, Strings, Ints, Longs, Doubles and
   *  null are the only classes the wire carries; anything else (BigDecimal, Float, a nested Map or Seq) is refused. */
  def unencodable(rows: Seq[Row]): Option[String] = {
    val it = rows.iterator
    while (it.hasNext) {
      val cells = it.next().valuesIterator
      while (cells.hasNext)
        cells.next() match {
          case null | _: Boolean | _: String | _: Int | _: Long | _: Double => ()
          case _                                                            => return Some("value type not previewable")
        }
    }
    None
  }

  def encode(row: Row): JsObject = SampleRowJson.encode(row)
}
