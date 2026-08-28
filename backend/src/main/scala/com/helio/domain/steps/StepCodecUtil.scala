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

  /** Extract an integer field with a default. */
  def intOr(obj: JsObject, key: String, default: Int): Int =
    obj.fields.get(key) match {
      case Some(JsNumber(n)) => scala.util.Try(n.toIntExact).getOrElse(default)
      case _                 => default
    }

  /** Strict WRITE-path check (HEL-860) for a `key` that must be a
   *  `Map[String, String]` when present (`cast`/`rename`'s `casts`/
   *  `renames`). Rejects only a *present* key that cannot be represented as
   *  that shape — a non-object value, or an object with any non-string
   *  value — naming both the offending key and the expected shape. An
   *  absent key is accepted and keeps its typed-decode default: the picker
   *  seeds a new step with `{}`, and previously-stored rows may legitimately
   *  omit the key, so rejecting absence would break both.
   *
   *  `shapeDescription` and `example` are supplied by the calling step (not
   *  hardcoded here): `cast`'s `casts` and `rename`'s `renames` are BOTH
   *  `Map[String, String]` at the type level but mean entirely different
   *  things — a field-name -> type-name map vs. a from-field-name ->
   *  to-field-name map. A single shared wording (e.g. "field name to type
   *  name") is actively wrong for one of them and would guide a caller
   *  fixing a `rename` rejection into sending a config this validator
   *  accepts but that silently renames a column to a type-name string —
   *  exactly the green-run/wrong-result shape this ticket exists to
   *  prevent. See HEL-860 evaluation-1.md CR-1. */
  def requireStringMap(obj: JsObject, key: String, kind: String, shapeDescription: String, example: String): Option[String] =
    obj.fields.get(key) match {
      case None                        => None
      case Some(o: JsObject) if o.fields.values.forall(_.isInstanceOf[JsString]) => None
      case Some(o: JsObject) =>
        Some(
          s"Invalid '$kind' config: '$key' must be an object mapping $shapeDescription, " +
            s"e.g. $example — got an object with a non-string value."
        )
      case Some(other) =>
        Some(
          s"Invalid '$kind' config: '$key' must be an object mapping $shapeDescription, " +
            s"e.g. $example — got ${jsonKindName(other)}."
        )
    }

  private def jsonKindName(v: JsValue): String = v match {
    case _: JsArray  => "an array"
    case _: JsString => "a string"
    case _: JsNumber => "a number"
    case JsBoolean(_) => "a boolean"
    case JsNull       => "null"
    case _            => "an unexpected shape"
  }
}
