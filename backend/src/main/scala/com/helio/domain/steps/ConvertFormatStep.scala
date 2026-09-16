package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import com.helio.domain.engine.PipelineRowJson
import com.fasterxml.jackson.core.{JsonParser => JacksonJsonParser}
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.ObjectNode
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** ConvertFormat step (HEL-1105, design.md) -- a deterministic, local 1:1 row transform: for
 *  every input row, reads `cfg.field`, converts it per `cfg.from`/`cfg.to`, and writes the
 *  result to `cfg.outputField` (all other fields pass through unchanged). No ClaudeClient, no AI
 *  hooks (owner ruling, tasks.md C1) -- AI-backed conversion is deferred to HEL-1135. */
final case class ConvertFormatStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ConvertFormatConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = ConvertFormatStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(ConvertFormatStep.apply(rows, config))
}

object ConvertFormatStep {
  val Kind: String = "convertformat"

  /** design.md D1/D6 -- the single source of truth for which `from`/`to` pairs are accepted,
   *  shared by the write-path validator ([[ConvertFormatConfig.pairError]]), the run-path
   *  dispatch ([[convert]]) and analyze inference (`PipelineAnalyzeService.inferConvertFormat`),
   *  so the three surfaces cannot diverge. */
  val SupportedPairs: Set[(String, String)] =
    Set("csv" -> "json", "json" -> "csv", "text" -> "markdown", "markdown" -> "text")

  /** design.md D3 -- every named failure reason, prefixed onto the `IllegalArgumentException`
   *  message so `StepExecutionException.from`'s allowlist (an `IllegalArgumentException`'s
   *  `getMessage` is kept verbatim) surfaces it to the run's error unmodified. */
  private def fail(code: String, detail: String): Nothing =
    throw new IllegalArgumentException(s"convertformat $code: $detail")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: ConvertFormatConfig): Seq[PipelineRowJson.Row] =
    rows.map { row =>
      val value = row.get(cfg.field) match {
        case None | Some(null)  => fail("field-missing", s"field '${cfg.field}' is missing or null")
        case Some(s: String)    => s
        case Some(_)            => fail("field-not-string", s"field '${cfg.field}' is not a string")
      }
      val converted = convert(value, cfg.from, cfg.to)
      row + (cfg.outputField -> converted)
    }

  private def convert(value: String, from: String, to: String): String = (from, to) match {
    case ("csv", "json")      => csvToJson(value)
    case ("json", "csv")      => jsonToCsv(value)
    case ("text", "markdown") => textToMarkdown(value)
    case ("markdown", "text") => markdownToText(value)
    case _                    =>
      // Defense-in-depth only -- the write path (`ConvertFormatConfig.pairError`) rejects every
      // unsupported pair before a step can be saved with one. Reachable only for a row persisted
      // before that validation existed.
      fail("unsupported-pair", s"'$from' -> '$to' is not a supported conversion pair")
  }

  // ── D4: CSV <-> JSON ──────────────────────────────────────────────────────

  /** HEL-1105 skeptic-final-2.md: spray-json's `JsObject.apply`/`JsonParser` both build their
   *  backing map as a `TreeMap` (alphabetically sorted by key), unconditionally -- NOT an
   *  insertion-order-preserving structure, and NOT merely a small-map artifact that only shows
   *  up past 4 entries (confirmed by reading spray-json 1.3.6's own source:
   *  `JsObject.apply(members: JsField*) = new JsObject(TreeMap(members: _*))` and
   *  `JsonParser.\`object\``'s `members` accumulator starting from `TreeMap.empty`). Both
   *  `csvToJson` (building via `JsObject(...)`) and `jsonToCsv` (reading via `text.parseJson`)
   *  therefore silently re-sorted every object's keys alphabetically, breaking design.md D4's
   *  "keys in header order" / "same keys, key order" promise in BOTH directions -- confirmed by
   *  a probe (`z,y,x,w,v` -> `v,w,x,y,z` each direction) before this fix. Jackson's `ObjectMapper`
   *  (already a backend dependency, build.sbt) is used instead for exactly this op's JSON
   *  read/write: its default `ObjectNode`/parse-to-`Map` path is `LinkedHashMap`-backed and
   *  preserves the JSON text's literal key order, both for what `csvToJson` writes and for what
   *  `jsonToCsv` reads back out (`objs.head`'s `fieldNames()` iteration order is header order). */
  private val jsonMapper: ObjectMapper = new ObjectMapper()

  /** RFC 4180-ish parse: quoted fields (embedded commas/quotes/newlines, `""` = escaped quote),
   *  `\r\n` or `\n` row separators. A quote only opens a quoted field at the START of a field
   *  (the empty-field-so-far check below); once closed, no further unescaped quote is expected
   *  before the next separator. */
  private def parseCsvRows(text: String): Vector[Vector[String]] = {
    if (text.isEmpty) return Vector.empty
    val rows          = Vector.newBuilder[Vector[String]]
    var fields         = Vector.newBuilder[String]
    val field          = new StringBuilder
    var inQuotes       = false
    var rowHasContent  = false
    var i              = 0
    val n              = text.length

    def endField(): Unit = { fields += field.toString(); field.clear() }
    def endRow(): Unit = {
      endField()
      rows += fields.result()
      fields = Vector.newBuilder[String]
      rowHasContent = false
    }

    while (i < n) {
      val c = text.charAt(i)
      if (inQuotes) {
        rowHasContent = true
        if (c == '"') {
          if (i + 1 < n && text.charAt(i + 1) == '"') { field.append('"'); i += 2 }
          else { inQuotes = false; i += 1 }
        } else { field.append(c); i += 1 }
      } else {
        c match {
          case '"' if field.isEmpty => inQuotes = true; rowHasContent = true; i += 1
          case ','                  => rowHasContent = true; endField(); i += 1
          case '\r' =>
            rowHasContent = true
            if (i + 1 < n && text.charAt(i + 1) == '\n') { endRow(); i += 2 } else { endRow(); i += 1 }
          case '\n' => rowHasContent = true; endRow(); i += 1
          case _    => rowHasContent = true; field.append(c); i += 1
        }
      }
    }
    if (inQuotes) fail("csv-malformed", "unterminated quoted field")
    if (rowHasContent) endRow()
    rows.result()
  }

  private def csvToJson(text: String): String = {
    val rows = parseCsvRows(text)
    if (rows.isEmpty) return "[]"
    val header = rows.head
    if (header.exists(_.isEmpty)) fail("csv-malformed", "header contains an empty column name")
    if (header.distinct.length != header.length) fail("csv-malformed", "header contains a duplicate column name")
    val arr = jsonMapper.createArrayNode()
    rows.tail.foreach { r =>
      if (r.length != header.length)
        fail("csv-malformed", s"row has ${r.length} column(s), expected ${header.length} (header count)")
      val obj = jsonMapper.createObjectNode()
      header.zip(r).foreach { case (k, v) => obj.put(k, v) }
      arr.add(obj)
    }
    jsonMapper.writeValueAsString(arr)
  }

  /** HEL-1105 evaluation-3.md CR1: `ObjectMapper.readTree(String)` (the cycle-3 fix) parses only
   *  the FIRST JSON value in `text` and silently ignores anything after it -- no
   *  `FAIL_ON_TRAILING_TOKENS`-equivalent is set by default, unlike spray-json's `JsonParser`
   *  (`value ~ EOI`), which the cycle-3 fix replaced. `[{"a":"1"}] garbage`, `[] ]` and
   *  `[{"a":"1"}] // comment` all silently "succeeded" with truncated, wrong output instead of
   *  the named `json-malformed` failure AC2 requires. Parses via an explicit `JsonParser`
   *  instead and requires end-of-input (`parser.nextToken() == null`) immediately after reading
   *  the tree; every failure path (a genuine parse exception, a `null`/missing tree -- e.g. empty
   *  or whitespace-only input -- or trailing tokens) folds into the same `json-malformed`
   *  message, closing the parser in every case. */
  private def jsonToCsv(text: String): String = {
    val parsed: JsonNode = {
      var parser: JacksonJsonParser = null
      try {
        parser = jsonMapper.createParser(text)
        val node: JsonNode = jsonMapper.readTree(parser)
        if (node == null || parser.nextToken() != null)
          fail("json-malformed", "input is not valid JSON")
        node
      } catch {
        case _: Exception => fail("json-malformed", "input is not valid JSON")
      } finally {
        if (parser != null) parser.close()
      }
    }
    if (!parsed.isArray) fail("json-not-array-of-objects", "top-level value is not an array")
    val items = parsed.elements().asScala.toVector
    if (items.isEmpty) return ""
    val objs = items.map { e =>
      if (!e.isObject) fail("json-not-array-of-objects", "an array element is not an object")
      e.asInstanceOf[ObjectNode]
    }
    val keys    = objs.head.fieldNames().asScala.toVector
    val keySet  = keys.toSet
    objs.foreach { o =>
      if (o.fieldNames().asScala.toSet != keySet) fail("json-inconsistent-keys", "objects do not share the same key set")
    }
    def cell(o: ObjectNode, k: String): String = {
      val v = o.get(k)
      if (v.isTextual) v.asText()
      else if (v.isObject || v.isArray) fail("json-nested-value", s"field '$k' holds a nested object/array")
      else fail("json-non-string-value", s"field '$k' is not a string")
    }
    val headerLine = keys.map(csvQuote).mkString(",")
    val dataLines  = objs.map(o => keys.map(k => csvQuote(cell(o, k))).mkString(","))
    (headerLine +: dataLines).mkString("\n")
  }

  private def csvQuote(s: String): String =
    if (s.exists(c => c == ',' || c == '"' || c == '\r' || c == '\n'))
      "\"" + s.replace("\"", "\"\"") + "\""
    else s

  // ── D5: text <-> Markdown ────────────────────────────────────────────────

  /** The CommonMark ASCII-punctuation escapable set (design.md D5), including `\`, `&`, `#`,
   *  `;` explicitly named there. */
  private val Punctuation: Set[Char] = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".toSet

  private def normalizeNewlines(t: String): String = t.replace("\r\n", "\n").replace("\r", "\n")

  /** Per-line encode: leading/trailing space/tab runs become `&#32;`/`&#9;` tokens (a
   *  whitespace-only line is thus fully encoded, since its whole length is "leading"); every
   *  other punctuation character is backslash-escaped; everything else is copied. */
  private def encodeLine(line: String): String = {
    val n = line.length
    var lead = 0
    while (lead < n && (line.charAt(lead) == ' ' || line.charAt(lead) == '\t')) lead += 1
    var trail = 0
    while (trail < n - lead && (line.charAt(n - 1 - trail) == ' ' || line.charAt(n - 1 - trail) == '\t')) trail += 1
    val sb = new StringBuilder
    var i  = 0
    while (i < n) {
      val c = line.charAt(i)
      if (i < lead || i >= n - trail) sb.append(if (c == ' ') "&#32;" else "&#9;")
      else if (Punctuation.contains(c)) { sb.append('\\'); sb.append(c) }
      else sb.append(c)
      i += 1
    }
    sb.toString()
  }

  private def textToMarkdown(t: String): String = {
    val normalized = normalizeNewlines(t)
    val lines       = normalized.split("\n", -1).toVector
    val encoded     = lines.map(encodeLine)
    val sb          = new StringBuilder
    var idx         = 0
    while (idx < encoded.length) {
      sb.append(encoded(idx))
      if (idx < encoded.length - 1) {
        val bothNonEmpty = lines(idx).nonEmpty && lines(idx + 1).nonEmpty
        sb.append(if (bothNonEmpty) "\\\n" else "\n")
      }
      idx += 1
    }
    sb.toString()
  }

  /** One left-to-right scan (design.md D5), consuming the first matching token at each
   *  position: backslash-escapes, the whitespace tokens, then (best-effort, never required for
   *  the text->markdown->text round trip since text->markdown never emits an unescaped marker) a
   *  documented subset of Markdown structural syntax, else a literal copy. Never throws -- every
   *  string is valid Markdown per D5. */
  private def markdownToText(m: String): String = {
    val n            = m.length
    val sb            = new StringBuilder
    var i              = 0
    var atLineStart    = true
    while (i < n) {
      val c = m.charAt(i)
      if (c == '\\' && i + 1 < n && m.charAt(i + 1) == '\n') {
        sb.append('\n'); i += 2; atLineStart = true
      } else if (c == '\\' && i + 1 < n && Punctuation.contains(m.charAt(i + 1))) {
        sb.append(m.charAt(i + 1)); i += 2; atLineStart = false
      } else if (m.startsWith("&#32;", i)) {
        sb.append(' '); i += 5; atLineStart = false
      } else if (m.startsWith("&#9;", i)) {
        sb.append('\t'); i += 4; atLineStart = false
      } else if (atLineStart && c == '#') {
        var j = i
        while (j < n && m.charAt(j) == '#' && (j - i) < 6) j += 1
        if (j < n && m.charAt(j) == ' ') { i = j + 1 } else { sb.append(c); i += 1 }
        atLineStart = false
      } else if (atLineStart && c == '>') {
        var j = i + 1
        if (j < n && m.charAt(j) == ' ') j += 1
        i = j; atLineStart = false
      } else if (atLineStart && (c == '-' || c == '*' || c == '+') && i + 1 < n && m.charAt(i + 1) == ' ') {
        i += 2; atLineStart = false
      } else if (c == '*' || c == '_') {
        var j = i
        while (j < n && m.charAt(j) == c) j += 1
        i = j; atLineStart = false
      } else if (c == '`') {
        var j = i
        while (j < n && m.charAt(j) == '`') j += 1
        i = j; atLineStart = false
      } else if (c == '[') {
        val close = m.indexOf(']', i + 1)
        val isLink = close > i && close + 1 < n && m.charAt(close + 1) == '('
        val urlEnd = if (isLink) m.indexOf(')', close + 2) else -1
        if (isLink && urlEnd > close) {
          sb.append(m.substring(i + 1, close))
          i = urlEnd + 1
        } else { sb.append(c); i += 1 }
        atLineStart = false
      } else {
        sb.append(c)
        i += 1
        atLineStart = c == '\n'
      }
    }
    sb.toString()
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.ContentFiles)
    override def catalogDescription: String   = "Convert a field's content between formats, such as CSV/JSON or text/Markdown."
    def decodeConfig(raw: String): Any    = ConvertFormatConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[ConvertFormatConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[ConvertFormatConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[ConvertFormatConfig].toJson

    /** design.md D1 -- shape errors (base `strictDecodeProblem`) plus the pair check. */
    override def validateRawConfig(raw: String): Option[String] =
      strictDecodeProblem(raw).orElse(ConvertFormatConfig.pairError(raw))

    /** design.md D1/D6 -- `field` is required to run/analyze; the pair must be one of
     *  [[SupportedPairs]] (this also catches a legacy/tolerant-decoded row whose `from`/`to`
     *  defaulted to `""`, which is never a supported pair). */
    override def requiredConfigProblems(raw: String): Vector[String] = {
      val cfg = ConvertFormatConfig.decode(raw)
      StepCodecUtil.missingRequired(Kind, "field" -> cfg.field) ++
        (if (SupportedPairs.contains((cfg.from, cfg.to))) Vector.empty
         else
           Vector(
             s"$Kind step has an unsupported from/to pair: '${cfg.from}' -> '${cfg.to}'. Supported: " +
               SupportedPairs.map { case (a, b) => s"$a->$b" }.mkString(", ")
           ))
    }
  }
}
