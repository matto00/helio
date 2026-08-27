package com.helio.domain.connectors

import org.apache.pekko.http.scaladsl.model.Uri
import spray.json.JsString

import scala.util.matching.Regex

/** HEL-823: resolves `{{name}}` placeholders against a plain `Map[String, String]`. Per
 *  design.md Decision 3, this object is deliberately dumb — it does ONLY substitution and
 *  fail-loud-on-unresolved detection; context-specific escaping (query/endpoint/header/body)
 *  is applied by the caller before/after invoking [[resolve]], not inside it. This keeps the
 *  resolver reusable across every templated field.
 *
 *  Taking a plain `Map[String, String]` rather than `RestApiConfig` directly is itself the
 *  extension seam for a later run-time/workspace-override ticket (design.md Decision 5) — that
 *  ticket merges additional maps in before calling `resolve`, without changing this signature.
 */
object TemplateInterpolator {

  /** Matches `{{name}}` where `name` is `[A-Za-z0-9_]+` — anything else inside double braces
   *  (design.md Decision 1) is left as literal text, not treated as a placeholder. */
  private val Placeholder: Regex = "\\{\\{([A-Za-z0-9_]+)\\}\\}".r

  /** Shared scan/substitute scaffolding for [[resolve]]/[[resolveEndpoint]]/[[resolveJsonBody]]
   *  — the three differ only in the `String => String` transform applied to each SUBSTITUTED
   *  value (identity, RFC-3986 path-segment encoding, JSON-string escaping respectively).
   *  Scans `template` left-to-right; the FIRST placeholder with no matching entry in `params`
   *  short-circuits to `Left(name)` (first-unresolved-wins) — never a blank/silent substitution.
   *  Returns `Right(resolved)` when every placeholder found resolves; a template with no
   *  placeholders at all returns `Right(template)` unchanged (task 4.6's byte-identical
   *  guarantee). `encodeValue` MUST be total (never throw) — a substituted value can be empty,
   *  and fail-loud is reserved for *unresolved* variables, not *empty* ones (skeptic-final-1
   *  CR1: `encodePathSegment` learned this the hard way). */
  private def resolveWith(template: String, params: Map[String, String], encodeValue: String => String): Either[String, String] = {
    var firstUnresolved: Option[String] = None
    val result = Placeholder.replaceAllIn(
      template,
      m => {
        val name = m.group(1)
        if (firstUnresolved.isDefined) {
          // Already found the first unresolved variable — further replacement output is
          // discarded (we return Left below), but replaceAllIn still needs a valid
          // replacement string to keep scanning without throwing.
          Regex.quoteReplacement("")
        } else {
          params.get(name) match {
            case Some(value) => Regex.quoteReplacement(encodeValue(value))
            case None =>
              firstUnresolved = Some(name)
              Regex.quoteReplacement("")
          }
        }
      }
    )
    firstUnresolved match {
      case Some(name) => Left(name)
      case None        => Right(result)
    }
  }

  /** Substitutes every `{{name}}` placeholder in `template` with `params(name)`, raw
   *  (no encoding) — used for query-param and header values, which apply their own
   *  context-specific handling after this call (Pekko's `Uri.Query` encoding, the CRLF guard,
   *  respectively; design.md Decision 3). */
  def resolve(template: String, params: Map[String, String]): Either[String, String] =
    resolveWith(template, params, identity)

  /** Endpoint-substitution encoding helper (design.md Decision 3, task 2.2): resolves
   *  `template` against `params`, but every SUBSTITUTED value is rendered as an opaque
   *  RFC-3986 path-segment literal via Pekko's `Uri.Path.Segment` — never via
   *  `java.net.URLEncoder` (form-encoding; renders space as `+`, not `%20`). Static
   *  (non-templated) text in `template` is left untouched. A substituted value can never
   *  introduce `/`, `?`, `#`, or a new path segment. */
  def resolveEndpoint(template: String, params: Map[String, String]): Either[String, String] =
    resolveWith(template, params, encodePathSegment)

  /** Renders `value` as a single RFC-3986-correct path segment (space -> `%20`, not `+`).
   *  Total on an empty `value` (skeptic-final-1 CR1): `Uri.Path.Segment` throws
   *  `IllegalArgumentException` on an empty head (pekko-http-core rejects it), which would
   *  otherwise escape as a raw exception instead of this file's curated-`Left` contract. An
   *  empty substituted value splices as empty text — it still cannot introduce a path segment,
   *  so this stays safe; fail-loud is reserved for *unresolved* variables, not *empty* ones. */
  private def encodePathSegment(value: String): String =
    if (value.isEmpty) "" else Uri.Path.Segment(value, Uri.Path.Empty).toString

  /** Body-substitution escaping helper (design.md Decision 3, task 2.4/4.7): resolves
   *  `template` against `params`, but every SUBSTITUTED value is JSON-string-escaped via
   *  [[jsonEscape]] before being spliced back in — the template's static text is assumed to
   *  already supply the surrounding JSON quoting/structure (e.g. `{"name": "{{userName}}"}`). */
  def resolveJsonBody(template: String, params: Map[String, String]): Either[String, String] =
    resolveWith(template, params, jsonEscape)

  /** Header-value CRLF-injection guard (task 2.3): returns `Left` with a curated error if the
   *  post-substitution value contains `\r` or `\n` — such a value is never sent. */
  def guardHeaderValue(value: String): Either[String, String] =
    if (value.contains("\r") || value.contains("\n"))
      Left("Header value contains illegal CR/LF characters after template substitution")
    else
      Right(value)

  /** JSON-body-value escaping helper (task 2.4): renders `value` the way it would appear
   *  inside a JSON string (escapes `"`, `\`, control characters, etc. per spray-json's own
   *  `JsString` writer) and strips the outer quotes `JsString(...).toString` adds, so the
   *  result can be spliced directly into a template's existing JSON string literal (e.g.
   *  `{"name": "{{userName}}"}` — the surrounding quotes come from the template). */
  def jsonEscape(value: String): String = {
    val quoted = JsString(value).toString
    quoted.stripPrefix("\"").stripSuffix("\"")
  }
}
