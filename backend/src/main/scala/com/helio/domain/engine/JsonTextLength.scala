package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import spray.json._

/** HEL-1679 (design.md D1): the exact size of a value's `compactPrint` text, computed WITHOUT building that text. The snapshot write uses it to close
 *  a batch by rendered size and the run path to refuse a row that would render past the per-run share, so neither has to render first to find out.
 *  It mirrors spray-json's printer; `JsonTextLengthSpec` asserts equality with `compactPrint` over adversarial values, so a printer change fails CI. */
object JsonTextLength {

  /** `chars` is `compactPrint.length` (UTF-16 code units); `utf8Bytes` is `compactPrint.getBytes(UTF_8).length`. */
  final case class Size(chars: Long, utf8Bytes: Long) {
    def +(other: Size): Size = Size(chars + other.chars, utf8Bytes + other.utf8Bytes)
  }

  private val Zero = Size(0L, 0L)

  /** Both sizes of `v`'s `compactPrint`. */
  def of(v: JsValue): Size = v match {
    case JsNull       => ascii(4)
    case JsTrue       => ascii(4)
    case JsFalse      => ascii(5)
    case JsNumber(n)  => ascii(n.toString.length)
    case JsString(s)  => string(s)
    case JsArray(els) =>
      // `[` + elements + (n - 1) commas + `]`
      els.foldLeft(ascii(2 + math.max(0, els.size - 1)))((acc, e) => acc + of(e))
    case JsObject(fields) =>
      // `{` + `key:value` pairs + (n - 1) commas + `}`; a pair adds the colon
      fields.foldLeft(ascii(2 + math.max(0, fields.size - 1))) { case (acc, (k, e)) => acc + string(k) + ascii(1) + of(e) }
  }

  /** `compactPrint.length` of `v`. */
  def chars(v: JsValue): Long = of(v).chars

  /** `compactPrint.getBytes(UTF_8).length` of `v`. */
  def utf8Bytes(v: JsValue): Long = of(v).utf8Bytes

  /** `compactPrint.length` of an engine row converted through [[PipelineRowJson.anyToJsValue]] (the conversion the writes use). One row's JSON structure
   *  is alive at a time; its strings are shared, and no text is built. */
  def ofRow(row: Row): Long = chars(JsObject(row.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) }))

  private def ascii(n: Int): Size = Size(n.toLong, n.toLong)

  /** A JSON string: quotes, the escapes spray's printer writes (`"`, `\`, `\b \f \n \r \t`, `\u00XX` for other controls below 0x20), and the
   *  UTF-8 width of every other character (a surrogate pair is 4 bytes, a lone surrogate encodes as `?`, 1 byte). */
  private def string(s: String): Size = {
    var chars = 2L
    var bytes = 2L
    var i     = 0
    val n     = s.length
    while (i < n) {
      val c = s.charAt(i)
      if (c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t') { chars += 2; bytes += 2 }
      else if (c < 0x20) { chars += 6; bytes += 6 }
      else if (c < 0x80) { chars += 1; bytes += 1 }
      else if (c < 0x800) { chars += 1; bytes += 2 }
      else if (Character.isHighSurrogate(c) && i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) { chars += 2; bytes += 4; i += 1 }
      else if (Character.isSurrogate(c)) { chars += 1; bytes += 1 }
      else { chars += 1; bytes += 3 }
      i += 1
    }
    Size(chars, bytes)
  }
}
