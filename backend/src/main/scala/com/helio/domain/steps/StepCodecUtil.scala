package com.helio.domain.steps

import spray.json._

/** Shared parsing helpers for per-step tolerant decoders.
 *
 *  Each step's `*Config.decode(raw)` follows the same pattern: parse the JSON
 *  text into a JsObject (or fall back to `{}` on a non-object top-level
 *  value), then pull each field with `.fields.get(...)` and a typed default.
 *  `asObject` and the small extractor helpers below keep that pattern
 *  consistent across the 10 step files. */
private[steps] object StepCodecUtil {

  /** Parse `raw` as JSON and return the top-level object — or
   *  [[JsObject.empty]] if the JSON is anything else (defensive against
   *  legacy rows that stored a raw scalar). Throws on malformed JSON: the
   *  per-step `decode` lives inside a top-level `Try` block at the codec
   *  facade so the failure surfaces as `Failure(...)` to the caller. */
  def asObject(raw: String): JsObject = JsonParser(raw) match {
    case o: JsObject => o
    case _           => JsObject.empty
  }

  /** Extract a string field with a default. */
  def stringOr(obj: JsObject, key: String, default: String): String =
    obj.fields.get(key) match {
      case Some(JsString(s)) => s
      case _                 => default
    }
}
