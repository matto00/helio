package com.helio.services.sources

import spray.json.{JsString, JsValue}

import java.nio.{ByteBuffer, CharBuffer}
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}

/** CSV-related helpers used by `DataSourceService` and the multipart-handling
 *  route shells that pass raw bytes through to it. Kept lightweight (no
 *  Pekko / repository dependencies) so it can be unit-tested in isolation. */
object DataSourceCsvSupport {

  def decodeUtf8(bytes: Array[Byte]): Option[String] =
    try {
      val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
      Some(decoder.decode(ByteBuffer.wrap(bytes)).toString)
    } catch {
      case _: CharacterCodingException => None
    }

  /** Strict UTF-8 validation that never materializes the text: decodes through one small reusable
   *  `CharBuffer` and discards it, so validating an upload costs a few KiB instead of the
   *  100+ MiB `decodeUtf8` allocates (a `CharBuffer` the size of the file, then its `String`).
   *  Accepts and rejects exactly what `decodeUtf8` does. */
  def isValidUtf8(bytes: Array[Byte]): Boolean = {
    val decoder = StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
    val in  = ByteBuffer.wrap(bytes)
    val out = CharBuffer.allocate(8192)
    var ok   = true
    var more = true
    while (ok && more) {
      val result = decoder.decode(in, out, true)
      if (result.isError) ok = false
      else if (result.isOverflow) out.clear()
      else more = false
    }
    if (ok) {
      var flushing = true
      while (ok && flushing) {
        val result = decoder.flush(out)
        if (result.isError) ok = false
        else if (result.isOverflow) out.clear()
        else flushing = false
      }
    }
    ok
  }

  def csvPathFromConfig(config: JsValue): Option[String] =
    config.asJsObject.fields.get("path").collect { case JsString(p) => p }
}
