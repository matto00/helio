package com.helio.domain.steps

import spray.json._

/** Raised by the strict extractors below when a configuration key is
 *  **present but of a JSON type that cannot represent the field's declared
 *  type** (HEL-814 D1). Extends `IllegalArgumentException` so the run path's
 *  `StepExecutionException.from` allowlist surfaces the message verbatim, and
 *  so existing `Try(decode(...))` call sites need no new failure channel.
 *
 *  Deliberately NOT raised for an absent key or for a present key holding an
 *  empty value of the correct type: every read of a stored step decodes its
 *  config, and `PipelineStepRepository.rowToDomain` turns a decode failure
 *  into a 500, so absence-strictness would break opening the pipeline editor
 *  on a step a user added but has not configured yet (20 such rows measured
 *  live across dev and prod). */
final class StepConfigTypeMismatch(message: String) extends IllegalArgumentException(message)

/** Shared parsing helpers for the per-step config decoders.
 *
 *  Each step's `*Config.decode(raw)` parses the JSON text into a `JsObject`
 *  then pulls each field with a typed extractor. Two families live here:
 *
 *  - **Strict read-path extractors** (`str`, `int`, `stringArray`, ...):
 *    absent key -> the supplied default; present-but-wrong-type -> raise
 *    [[StepConfigTypeMismatch]] naming the key and the shape it expected.
 *    This is HEL-814 D1.
 *  - **Write-path validators** (`requireStringMap`): HEL-860's strict check
 *    of a caller-supplied raw config, kept because its per-key wording is
 *    part of that ticket's contract.
 *
 *  `JsNull` at a KEY position is treated as absence, not as a wrong type:
 *  a serializer emitting `{"joinKey": null}` for an unset optional is
 *  expressing the same thing as omitting it, and D1's whole premise is that
 *  absence stays tolerant. `JsNull` as an ARRAY ELEMENT is a wrong type, and
 *  raises — an element is a value the caller affirmatively supplied. */
private[steps] object StepCodecUtil {

  /** Parse `raw` as JSON and return the top-level object.
   *
   *  HEL-814 task 2.4: a top-level value that is not an object (a stored
   *  scalar such as `"42"`) is a value present at the config position whose
   *  JSON type cannot represent an object, so it raises rather than
   *  degrading every key to its default at once. This is covered by D1 and
   *  is deliberately not exempted — it is the single worst instance of the
   *  class, since it silently defaults the WHOLE config.
   *
   *  Still throws on malformed JSON, as before: every `decode` runs inside a
   *  `Try` at the codec facade, so both failures surface as `Failure(...)`. */
  def asObject(raw: String): JsObject = JsonParser(raw) match {
    case o: JsObject => o
    case other       => throw mismatch("<config>", "a JSON object", other)
  }

  /** A present key's value, or `None` when the key is absent or `null`. */
  private def present(obj: JsObject, key: String): Option[JsValue] =
    obj.fields.get(key).filterNot(_ == JsNull)

  private def mismatch(key: String, expected: String, got: JsValue): StepConfigTypeMismatch =
    new StepConfigTypeMismatch(s"'$key' must be $expected, got ${jsonKindName(got)}.")

  // ── Strict scalar extractors ────────────────────────────────────────────

  /** String key with a default. Absent -> `default`; non-string -> raise. */
  def str(obj: JsObject, key: String, default: String): String =
    present(obj, key) match {
      case None                 => default
      case Some(JsString(s))    => s
      case Some(other)          => throw mismatch(key, "a string", other)
    }

  /** Optional string key. Absent -> `None`; non-string -> raise. */
  def strOpt(obj: JsObject, key: String): Option[String] =
    present(obj, key) match {
      case None              => None
      case Some(JsString(s)) => Some(s)
      case Some(other)       => throw mismatch(key, "a string", other)
    }

  /** Integer key with a default. Absent -> `default`; non-number -> raise.
   *
   *  A correctly-typed number that cannot be represented as an `Int` keeps
   *  the default here rather than raising: that is a VALUE problem, not a
   *  TYPE problem, and D4 rejects it at analyze and run (where the raw
   *  config is still available) instead of at decode, so a stored row
   *  carrying one still lists. See `LimitStep`'s `countProblems`. */
  def int(obj: JsObject, key: String, default: Int): Int =
    present(obj, key) match {
      case None                 => default
      case Some(JsNumber(n))    => scala.util.Try(n.toIntExact).getOrElse(default)
      case Some(other)          => throw mismatch(key, "a number", other)
    }

  /** Optional integer key. Absent -> `None`; non-number -> raise. */
  def intOpt(obj: JsObject, key: String): Option[Int] =
    present(obj, key) match {
      case None              => None
      case Some(JsNumber(n)) => scala.util.Try(n.toIntExact).toOption
      case Some(other)       => throw mismatch(key, "a number", other)
    }

  // ── Strict collection extractors ────────────────────────────────────────

  /** Array-of-strings key. Absent -> `Vector.empty`; a non-array value, or
   *  ANY non-string element, raises. A mismatched element fails the whole
   *  configuration rather than being dropped (D1): a partially-decoded
   *  collection is worse than a failure, because it looks plausible. */
  def stringArray(obj: JsObject, key: String): Vector[String] =
    present(obj, key) match {
      case None => Vector.empty
      case Some(JsArray(items)) =>
        items.map {
          case JsString(s) => s
          case other =>
            throw new StepConfigTypeMismatch(
              s"'$key' must be an array of strings, but one element is ${jsonKindName(other)}."
            )
        }
      case Some(other) => throw mismatch(key, "an array of strings", other)
    }

  /** Array-of-objects key decoded through `T`'s own JSON format. Absent ->
   *  `Vector.empty`; a non-array value, or any element `T` cannot read,
   *  raises. `elementShape` describes the element per-key (e.g.
   *  "an array of {field, direction} objects") so the message is specific
   *  rather than a shared generic string. */
  def typedArray[T](obj: JsObject, key: String, elementShape: String)(implicit
      reader: JsonReader[T]
  ): Vector[T] =
    present(obj, key) match {
      case None => Vector.empty
      case Some(JsArray(items)) =>
        items.map { item =>
          scala.util.Try(reader.read(item)).getOrElse(throw mismatch(key, elementShape, item))
        }
      case Some(other) => throw mismatch(key, elementShape, other)
    }

  /** Object-valued key. Absent -> `None`; non-object -> raise. */
  def objectOpt(obj: JsObject, key: String): Option[JsObject] =
    present(obj, key) match {
      case None                 => None
      case Some(o: JsObject)    => Some(o)
      case Some(other)          => throw mismatch(key, "an object", other)
    }

  /** Object-of-string-to-string key (`cast`'s `casts`, `rename`'s
   *  `renames`). Absent -> `Map.empty`; a non-object value, or an object
   *  with any non-string value, raises. `shapeDescription` is supplied by
   *  the calling step so the message says what the map MEANS, not just its
   *  type — see [[requireStringMap]]'s note. */
  def stringMap(obj: JsObject, key: String, shapeDescription: String): Map[String, String] =
    present(obj, key) match {
      case None => Map.empty
      case Some(o: JsObject) =>
        o.fields.map {
          case (k, JsString(v)) => k -> v
          case (k, other) =>
            throw new StepConfigTypeMismatch(
              s"'$key' must be an object mapping $shapeDescription, " +
                s"but '$k' holds ${jsonKindName(other)}."
            )
        }
      case Some(other) =>
        throw new StepConfigTypeMismatch(
          s"'$key' must be an object mapping $shapeDescription, got ${jsonKindName(other)}."
        )
    }

  // ── Runtime-completeness helpers (HEL-814 D3) ───────────────────────────

  /** Build the "missing required value" problems for `kind` from
   *  `(key, value)` pairs, one message per blank value. The wording follows
   *  HEL-859's shape — the run path prefixes it with the failing step's id
   *  and kind, and the analyze path reports the same string through
   *  `validationError`, so the two surfaces cannot disagree. */
  def missingRequired(kind: String, fields: (String, String)*): Vector[String] =
    fields.toVector.collect {
      case (key, value) if value == null || value.trim.isEmpty =>
        s"$kind step is missing required config value '$key'."
    }

  /** Enum problem for a supplied value that matches no supported member
   *  case-insensitively. An absent value never reaches here — callers pass
   *  the decoded value, whose default is already a supported member. */
  def unsupportedEnum(kind: String, key: String, value: String, supported: Vector[String]): Vector[String] =
    if (supported.exists(_.equalsIgnoreCase(value))) Vector.empty
    else Vector(s"Unsupported $kind $key: '$value'. Supported: ${supported.mkString(", ")}")

  /** Canonical spelling of `value` when it matches a member of `supported`
   *  case-insensitively, else `value` UNCHANGED (HEL-814 D4/5.1b). Decode
   *  never substitutes a different member: preserving the supplied value is
   *  what makes it visible to the analyze and run surfaces that reject it,
   *  and what keeps a stored row readable. */
  def normalizeEnum(value: String, supported: Vector[String]): String =
    supported.find(_.equalsIgnoreCase(value)).getOrElse(value)

  // ── Write path (HEL-860) ────────────────────────────────────────────────

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
    case _: JsObject => "an object"
    case JsBoolean(_) => "a boolean"
    case JsNull       => "null"
    case _            => "an unexpected shape"
  }
}
