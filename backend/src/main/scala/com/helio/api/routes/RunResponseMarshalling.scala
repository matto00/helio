package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpResponse, StatusCode}
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import spray.json.{CompactPrinter, JsArray, JsObject, JsString, JsValue, RootJsonWriter}

import java.lang.{StringBuilder => JStringBuilder}
import scala.collection.mutable.ArrayBuffer

/** HEL-1693: the response of a manual run (and of the two apply endpoints that embed one) as a chunked `application/json` stream.
 *
 *  Spray's default marshalling renders the whole value to ONE compact `String`, then to ONE strict body: every terminal row's text twice over at
 *  once (UTF-16, then UTF-8), outside the per-run share HEL-1660/1679 bound. [[chunkedJson]] writes the SAME bytes one piece at a time instead:
 *  containers emit their own punctuation and recurse, and every key and scalar is rendered by spray's own [[CompactPrinter]], so escaping, numbers and
 *  field order are spray's (the printer-equivalence spec holds it to that). A piece is flushed at a value boundary once it holds [[PieceChars]]
 *  characters, so the largest piece is about [[PieceChars]] plus the widest single value, which for run rows is capped by `RunLimits`.
 *  Pieces come from a lazy iterator: at most one is alive beyond the response tree itself.
 *
 *  This is the one definition the three routes and `RunPathHeapSpec` share; no field, row or status is changed (body byte-identical, only the
 *  transport framing is chunked instead of `Content-Length`). */
object RunResponseMarshalling {

  /** Characters after which the buffered piece is flushed at the next value boundary. */
  val PieceChars: Int = 65536

  /** `status` with `value` as a chunked compact-JSON body. */
  def chunkedJson[T](status: StatusCode, value: T)(implicit writer: RootJsonWriter[T]): HttpResponse =
    chunkedEntity(status, writer.write(value))

  private[routes] def chunkedEntity(status: StatusCode, json: JsValue): HttpResponse =
    HttpResponse(
      status = status,
      entity = HttpEntity.Chunked.fromData(ContentTypes.`application/json`, Source.fromIterator(() => pieces(json).map(ByteString(_))))
    )

  /** The compact JSON of `root` as a lazy sequence of strings that concatenate to exactly `CompactPrinter(root)`. */
  def pieces(root: JsValue, pieceChars: Int = PieceChars): Iterator[String] = new Iterator[String] {
    private sealed trait Frame
    private final class Arr(val it: Iterator[JsValue]) extends Frame { var first = true }
    private final class Obj(val it: Iterator[(String, JsValue)]) extends Frame { var first = true }

    private val stack = ArrayBuffer.empty[Frame]
    private var started = false

    private def open(v: JsValue, sb: JStringBuilder): Unit = v match {
      case JsArray(elements) => sb.append('['); stack += new Arr(elements.iterator)
      case JsObject(fields)  => sb.append('{'); stack += new Obj(fields.iterator)
      case scalar            => sb.append(CompactPrinter(scalar))
    }

    private def step(sb: JStringBuilder): Unit = stack.last match {
      case a: Arr =>
        if (a.it.hasNext) { if (!a.first) sb.append(','); a.first = false; open(a.it.next(), sb) }
        else { sb.append(']'); stack.remove(stack.length - 1) }
      case o: Obj =>
        if (o.it.hasNext) {
          val (key, value) = o.it.next()
          if (!o.first) sb.append(','); o.first = false
          sb.append(CompactPrinter(JsString(key))).append(':'); open(value, sb)
        } else { sb.append('}'); stack.remove(stack.length - 1) }
    }

    override def hasNext: Boolean = !started || stack.nonEmpty

    override def next(): String = {
      if (!hasNext) throw new NoSuchElementException("no more pieces")
      val sb = new JStringBuilder(math.min(pieceChars + 1024, 1 << 20))
      if (!started) { started = true; open(root, sb) }
      // Flush only between elements: the check runs after an element has been fully written, never inside one.
      while (stack.nonEmpty && sb.length < pieceChars) step(sb)
      sb.toString
    }
  }
}
