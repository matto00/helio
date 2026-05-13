package com.helio.api.routes

import spray.json.{JsString, JsValue}

import java.nio.ByteBuffer
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}

/** CSV-related helpers shared by `DataSourceRoutes` and `DataSourcePreviewRoutes`.
 *  Kept lightweight (no Pekko / repository dependencies) so it can be unit-tested
 *  in isolation if needed. */
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

  def csvPathFromConfig(config: JsValue): Option[String] =
    config.asJsObject.fields.get("path").collect { case JsString(p) => p }
}
