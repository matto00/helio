package com.helio.services

import spray.json.{JsString, JsValue}

import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}

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
      case _: java.nio.charset.CharacterCodingException => None
    }

  def csvPathFromConfig(config: JsValue): Option[String] =
    config.asJsObject.fields.get("path").collect { case JsString(p) => p }
}
