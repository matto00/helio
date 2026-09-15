package com.helio.domain.steps

import com.helio.domain.engine.{InProcessPipelineEngine, StepExecutionException}
import com.helio.domain.model.{PipelineId, PipelineStepId}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}
import scala.util.Random

/** HEL-1105 (design.md D4/D5): standalone unit-test spec for the `convertformat` op's
 *  conversion logic, mirroring `SplitTextStepSpec`'s "intentionally standalone" precedent --
 *  the conversion functions are tested directly, with one engine-level test (task 4.3)
 *  confirming the failure actually surfaces through `StepExecutionException`. No ScalaCheck
 *  dependency exists in this project's test scope -- the "property-style" tests (task 4.1) are a
 *  hand-rolled seeded-`Random` generator loop instead. */
class ConvertFormatStepSpec extends AnyWordSpec with Matchers {

  private def cfg(field: String, from: String, to: String, outputField: String = ""): ConvertFormatConfig =
    ConvertFormatConfig(field, from, to, if (outputField.isEmpty) field else outputField)

  // ── D4: CSV <-> JSON round trip ──────────────────────────────────────────

  "ConvertFormatStep.apply (csv -> json)" should {

    "converts simple CSV to a JSON array of string-valued objects, keys in header order" in {
      val rows   = Seq(Map[String, Any]("content" -> "a,b\n1,2\n3,4"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      result.head("content") shouldBe """[{"a":"1","b":"2"},{"a":"3","b":"4"}]"""
    }

    "handles commas, doubled quotes and an embedded newline inside a quoted field" in {
      val csv    = "name,note\n\"Smith, John\",\"He said \"\"hi\"\"\nand left\""
      val rows   = Seq(Map[String, Any]("content" -> csv))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      val json   = result.head("content").asInstanceOf[String].parseJson
      json shouldBe JsArray(
        JsObject("name" -> JsString("Smith, John"), "note" -> JsString("He said \"hi\"\nand left"))
      )
    }

    "handles CRLF row separators identically to LF" in {
      val lf   = Seq(Map[String, Any]("content" -> "a,b\n1,2"))
      val crlf = Seq(Map[String, Any]("content" -> "a,b\r\n1,2"))
      ConvertFormatStep.apply(lf, cfg("content", "csv", "json")).head("content") shouldBe
        ConvertFormatStep.apply(crlf, cfg("content", "csv", "json")).head("content")
    }

    "header-only CSV converts to an empty array (documented lossy case)" in {
      val rows   = Seq(Map[String, Any]("content" -> "a,b"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      result.head("content") shouldBe "[]"
    }

    "empty string converts to an empty array" in {
      val rows   = Seq(Map[String, Any]("content" -> ""))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      result.head("content") shouldBe "[]"
    }
  }

  "ConvertFormatStep.apply (json -> csv)" should {

    "converts an array of string-valued objects to header + rows, no trailing newline" in {
      val rows   = Seq(Map[String, Any]("content" -> """[{"a":"1","b":"2"},{"a":"3","b":"4"}]"""))
      val result = ConvertFormatStep.apply(rows, cfg("content", "json", "csv"))
      result.head("content") shouldBe "a,b\n1,2\n3,4"
    }

    "quotes a field iff it contains a comma, quote, CR or LF, doubling internal quotes" in {
      val rows   = Seq(Map[String, Any]("content" -> """[{"note":"He said \"hi\", then left\nfor real"}]"""))
      val result = ConvertFormatStep.apply(rows, cfg("content", "json", "csv"))
      result.head("content") shouldBe "note\n\"He said \"\"hi\"\", then left\nfor real\""
    }

    "an empty array converts to an empty string" in {
      val rows   = Seq(Map[String, Any]("content" -> "[]"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "json", "csv"))
      result.head("content") shouldBe ""
    }

    // HEL-1105 skeptic-final-2.md: the header must follow the FIRST object's own key order, not
    // an alphabetically-sorted order. 5 keys (>4) deliberately -- Scala's small-Map
    // specializations (Map1..Map4) happen to preserve insertion order up to 4 entries, which
    // would mask a regression back to an unordered/sorted `Map`-backed implementation.
    "header follows the first object's own key order, not alphabetical, with more than 4 keys" in {
      val rows   = Seq(Map[String, Any]("content" -> """[{"z":"1","m":"2","a":"3","q":"4","b":"5"}]"""))
      val result = ConvertFormatStep.apply(rows, cfg("content", "json", "csv"))
      result.head("content") shouldBe "z,m,a,q,b\n1,2,3,4,5"
    }
  }

  "CSV <-> JSON round trip" should {

    "csv -> json -> csv reproduces the canonical form, every cell byte-identical" in {
      val csv = "name,note\n\"Smith, John\",\"He said \"\"hi\"\"\nand left\"\nJane,plain"
      val toJson = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> csv)), cfg("content", "csv", "json")).head("content").asInstanceOf[String]
      val back   = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> toJson)), cfg("content", "json", "csv")).head("content").asInstanceOf[String]
      // canonical(csv): CRLF-free, LF row separators, quote only where required.
      back shouldBe "name,note\n\"Smith, John\",\"He said \"\"hi\"\"\nand left\"\nJane,plain"
    }

    "json -> csv -> json is structurally equal (same keys, order, string values)" in {
      val json = """[{"a":"1","b":"x,y"},{"a":"2","b":"z"}]"""
      val toCsv = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> json)), cfg("content", "json", "csv")).head("content").asInstanceOf[String]
      val back  = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> toCsv)), cfg("content", "csv", "json")).head("content").asInstanceOf[String]
      back.parseJson shouldBe json.parseJson
    }

    // HEL-1105 skeptic-final-2.md: the exact regression the skeptic's probe found on unmutated
    // code -- `z,y,x,w,v` reordered to `v,w,x,y,z` in BOTH directions, via spray-json's
    // `JsObject`/`JsonParser` both building a `TreeMap` (always alphabetically sorted,
    // unconditionally -- not just a >4-entry small-map artifact). 5 columns (>4), deliberately
    // reverse-alphabetical so any residual sorting is immediately visible.
    "csv -> json -> csv reproduces a non-alphabetical, more-than-4-column header exactly" in {
      val csv    = "z,y,x,w,v\n1,2,3,4,5\n6,7,8,9,10"
      val toJson = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> csv)), cfg("content", "csv", "json")).head("content").asInstanceOf[String]
      val back   = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> toJson)), cfg("content", "json", "csv")).head("content").asInstanceOf[String]
      back shouldBe csv
    }

    "json -> csv -> json preserves a non-alphabetical, more-than-4-key order" in {
      val json  = """[{"z":"1","y":"2","x":"3","w":"4","v":"5"}]"""
      val toCsv = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> json)), cfg("content", "json", "csv")).head("content").asInstanceOf[String]
      toCsv shouldBe "z,y,x,w,v\n1,2,3,4,5"
      val back  = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> toCsv)), cfg("content", "csv", "json")).head("content").asInstanceOf[String]
      back shouldBe json
    }

    "property: round trip holds over generated CSV-safe string cells" in {
      val rnd = new Random(42)
      val candidates = Vector("abc123", "has,comma", "has\"quote", "has\nnewline", "", "plain text", "a\"b\"c", ",,,")
      (1 to 50).foreach { _ =>
        val a = candidates(rnd.nextInt(candidates.length))
        val b = candidates(rnd.nextInt(candidates.length))
        val json  = JsArray(JsObject("x" -> JsString(a), "y" -> JsString(b))).compactPrint
        val toCsv = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> json)), cfg("content", "json", "csv")).head("content").asInstanceOf[String]
        val back  = ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> toCsv)), cfg("content", "csv", "json")).head("content").asInstanceOf[String]
        withClue(s"a=$a b=$b: ") { back.parseJson shouldBe json.parseJson }
      }
    }
  }

  // ── D5: text <-> Markdown round trip ─────────────────────────────────────

  private def toMarkdown(t: String): String =
    ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> t)), cfg("content", "text", "markdown")).head("content").asInstanceOf[String]

  "text -> markdown -> text round trip" should {

    def roundTrip(t: String): String = {
      val md = toMarkdown(t)
      ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> md)), cfg("content", "markdown", "text")).head("content").asInstanceOf[String]
    }

    "plain text with no special characters" in {
      roundTrip("hello world") shouldBe "hello world"
    }

    "Markdown-significant characters survive (headings, emphasis, links, leading spaces)" in {
      val t = "# not a heading\n*stars*\n[brackets](x)\n  leading spaces\nsingle line breaks"
      roundTrip(t) shouldBe t
    }

    "leading and trailing spaces and tabs" in {
      val t = "  \tleading and trailing\t  "
      roundTrip(t) shouldBe t
    }

    "blank lines are preserved as paragraph breaks" in {
      val t = "para one\n\npara two"
      roundTrip(t) shouldBe t
    }

    "a line of only spaces and tabs is fully encoded and round-trips" in {
      val t = "before\n   \t \nafter"
      roundTrip(t) shouldBe t
    }

    "a literal &#32; and &#9; in the input survive" in {
      val t = "value is &#32; and &#9; literally"
      roundTrip(t) shouldBe t
    }

    "a line ending in one literal backslash before a newline" in {
      val t = "line one\\\nline two"
      roundTrip(t) shouldBe t
    }

    "a line ending in two literal backslashes before a newline" in {
      val t = "line one\\\\\nline two"
      roundTrip(t) shouldBe t
    }

    "a line ending in three literal backslashes before a newline" in {
      val t = "line one\\\\\\\nline two"
      roundTrip(t) shouldBe t
    }

    "a text that is exactly one backslash" in {
      roundTrip("\\") shouldBe "\\"
    }

    "CRLF and CR line endings normalize to LF" in {
      roundTrip("a\r\nb\rc") shouldBe "a\nb\nc"
    }

    "property: round trip holds over generated strings (normalized to LF)" in {
      val rnd = new Random(7)
      val chars = ('a' to 'z').toVector ++ ('0' to '9').toVector ++
        Vector(' ', '\t', '\n', '\\', '&', '#', ';', '*', '_', '`', '[', ']', '(', ')', '>', '-', '.', '!')
      (1 to 100).foreach { _ =>
        val len = rnd.nextInt(20)
        val s   = (1 to len).map(_ => chars(rnd.nextInt(chars.length))).mkString
        val normalized = s.replace("\r\n", "\n").replace("\r", "\n")
        withClue(s"s=${s.map(c => if (c == '\n') "\\n" else c.toString).mkString}: ") {
          roundTrip(s) shouldBe normalized
        }
      }
    }
  }

  // ── D5: assertions on the INTERMEDIATE Markdown string itself ────────────
  // skeptic-final-1.md non-blocking note 1 (promoted to required, cycle 2): the round-trip
  // tests above are all blind to whether `textToMarkdown` actually emits valid hard-break/
  // escape syntax, because `markdownToText`'s generic fallback decodes a bare `\n` back to
  // `\n` identically to how it decodes an escaped hard break -- a mutation that always joined
  // lines with a bare `\n` (never the documented `\` + `\n` hard break) left all 15 round-trip
  // tests green. These tests assert on `toMarkdown`'s OUTPUT directly, proving the capability
  // spec's own "text->markdown output SHALL render as the literal text" requirement and
  // design.md D5's join rule, independent of whether the decode side happens to tolerate the
  // mutation. Mutation evidence for both rules recorded in files-modified.md.
  "textToMarkdown (intermediate Markdown output)" should {

    "two adjacent non-empty lines are joined with a backslash hard break (\\ + \\n)" in {
      toMarkdown("a\nb") shouldBe "a\\\nb"
    }

    "a blank line between two lines is preserved as bare newlines, not a hard break" in {
      toMarkdown("a\n\nb") shouldBe "a\n\nb"
    }

    "three non-empty lines each get their own hard break" in {
      toMarkdown("a\nb\nc") shouldBe "a\\\nb\\\nc"
    }

    "leading and trailing spaces become &#32; tokens" in {
      toMarkdown(" a ") shouldBe "&#32;a&#32;"
    }

    "leading and trailing tabs become &#9; tokens" in {
      toMarkdown("\ta\t") shouldBe "&#9;a&#9;"
    }

    "a Markdown-significant character is backslash-escaped" in {
      toMarkdown("*a*") shouldBe "\\*a\\*"
    }

    "a heading-like line is escaped, not rendered as a real ATX heading" in {
      toMarkdown("# not a heading") shouldBe "\\# not a heading"
    }
  }

  // ── D3: named failure reasons, one test per code (task 4.2) ──────────────
  // Each arm's failability-by-mutation is recorded in files-modified.md (C6).

  "ConvertFormatStep.apply failure reasons" should {

    def failWith(code: String, rows: Seq[Map[String, Any]], c: ConvertFormatConfig): Unit = {
      val ex = intercept[IllegalArgumentException] { ConvertFormatStep.apply(rows, c) }
      ex.getMessage should include(s"convertformat $code")
    }

    "field-missing when the field is absent" in {
      failWith("field-missing", Seq(Map[String, Any]("other" -> "x")), cfg("content", "csv", "json"))
    }

    "field-missing when the field is null" in {
      failWith("field-missing", Seq(Map[String, Any]("content" -> null)), cfg("content", "csv", "json"))
    }

    "field-not-string when the field holds a non-string value" in {
      failWith("field-not-string", Seq(Map[String, Any]("content" -> 42)), cfg("content", "csv", "json"))
    }

    "csv-malformed on an unterminated quoted field" in {
      // Single-column CSV so an unterminated quote does NOT also trip the ragged-row check --
      // this isolates the unterminated-quote check itself (a mutation removing ONLY that check
      // would otherwise still be masked by the ragged-row fallback and this test would stay
      // green, which is exactly the vacuous-pass C6 exists to catch).
      failWith("csv-malformed", Seq(Map[String, Any]("content" -> "a\n\"unterminated")), cfg("content", "csv", "json"))
    }

    "csv-malformed on a ragged row (column count mismatch)" in {
      failWith("csv-malformed", Seq(Map[String, Any]("content" -> "a,b\n1,2,3")), cfg("content", "csv", "json"))
    }

    "csv-malformed on a duplicate header name" in {
      failWith("csv-malformed", Seq(Map[String, Any]("content" -> "a,a\n1,2")), cfg("content", "csv", "json"))
    }

    "csv-malformed on an empty header name" in {
      failWith("csv-malformed", Seq(Map[String, Any]("content" -> "a,\n1,2")), cfg("content", "csv", "json"))
    }

    "json-malformed on unparseable JSON" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> "not json")), cfg("content", "json", "csv"))
    }

    // HEL-1105 evaluation-3.md CR1: `ObjectMapper.readTree(String)` (the cycle-3 fix) parses only
    // the first JSON value and silently ignores trailing content -- spray-json's `JsonParser`
    // (`value ~ EOI`), which cycle-3 replaced, correctly rejected all of these as json-malformed.
    "json-malformed on trailing garbage after an otherwise-valid array" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> """[{"a":"1"}] garbage""")), cfg("content", "json", "csv"))
    }

    "json-malformed on an extra trailing closing bracket" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> "[] ]")), cfg("content", "json", "csv"))
    }

    "json-malformed on a trailing comment after an otherwise-valid array" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> """[{"a":"1"}] // comment""")), cfg("content", "json", "csv"))
    }

    "json-malformed on an empty string" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> "")), cfg("content", "json", "csv"))
    }

    "json-malformed on a whitespace-only string" in {
      failWith("json-malformed", Seq(Map[String, Any]("content" -> "   ")), cfg("content", "json", "csv"))
    }

    "json-not-array-of-objects when the top-level value is not an array" in {
      failWith("json-not-array-of-objects", Seq(Map[String, Any]("content" -> """{"a":"1"}""")), cfg("content", "json", "csv"))
    }

    "json-not-array-of-objects when an array element is not an object" in {
      failWith("json-not-array-of-objects", Seq(Map[String, Any]("content" -> """["not-an-object"]""")), cfg("content", "json", "csv"))
    }

    "json-nested-value when a cell holds an object" in {
      failWith("json-nested-value", Seq(Map[String, Any]("content" -> """[{"a":{"nested":true}}]""")), cfg("content", "json", "csv"))
    }

    "json-nested-value when a cell holds an array" in {
      failWith("json-nested-value", Seq(Map[String, Any]("content" -> """[{"a":[1,2]}]""")), cfg("content", "json", "csv"))
    }

    "json-non-string-value when a cell holds a number" in {
      failWith("json-non-string-value", Seq(Map[String, Any]("content" -> """[{"a":1}]""")), cfg("content", "json", "csv"))
    }

    "json-non-string-value when a cell holds a boolean" in {
      failWith("json-non-string-value", Seq(Map[String, Any]("content" -> """[{"a":true}]""")), cfg("content", "json", "csv"))
    }

    "json-non-string-value when a cell holds null" in {
      failWith("json-non-string-value", Seq(Map[String, Any]("content" -> """[{"a":null}]""")), cfg("content", "json", "csv"))
    }

    "json-inconsistent-keys when objects do not share the same key set" in {
      failWith("json-inconsistent-keys", Seq(Map[String, Any]("content" -> """[{"a":"1"},{"b":"2"}]""")), cfg("content", "json", "csv"))
    }

    "no rows are emitted on failure -- the whole run fails on the first bad row" in {
      val ex = intercept[IllegalArgumentException] {
        ConvertFormatStep.apply(Seq(Map[String, Any]("content" -> "not json")), cfg("content", "json", "csv"))
      }
      ex.getMessage should include("json-malformed")
    }
  }

  // ── Row-level shape (D2: 1:1, other fields passthrough) ──────────────────

  "ConvertFormatStep.apply row shape" should {

    "passes through other row fields unchanged and writes to outputField" in {
      val rows = Seq(Map[String, Any]("content" -> "a,b\n1,2", "filename" -> "doc.csv"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json", "contentJson"))
      result.head("filename") shouldBe "doc.csv"
      result.head("content") shouldBe "a,b\n1,2"
      result.head("contentJson") shouldBe """[{"a":"1","b":"2"}]"""
    }

    "outputField defaults to field, overwriting it in place" in {
      val rows = Seq(Map[String, Any]("content" -> "a,b\n1,2"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      result.head("content") shouldBe """[{"a":"1","b":"2"}]"""
    }

    "each input row yields exactly one output row (three in, three out)" in {
      val rows = (1 to 3).map(i => Map[String, Any]("content" -> s"a\n$i"))
      val result = ConvertFormatStep.apply(rows, cfg("content", "csv", "json"))
      result should have size 3
    }
  }

  // ── Task 4.3: engine surfaces the failure through StepExecutionException ─

  "the engine" should {
    "surface a convertformat failure through StepExecutionException carrying the named reason, not the opaque fallback" in {
      implicit val ec: ExecutionContext = ExecutionContext.global
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)
      val now    = Instant.now()
      val step = ConvertFormatStep(
        PipelineStepId("step-cf"), PipelineId("pipe-cf"), 0,
        cfg("content", "json", "csv"), now, now
      )
      val rows: Seq[Map[String, Any]] = Seq(Map("content" -> "not json"))

      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(rows, Seq(step), null), 5.seconds)
      }
      ex.reason should include("json-malformed")
      ex.reason should not include "step execution failed"
    }
  }

  // ── Task 4.4: config validation ──────────────────────────────────────────

  "ConvertFormatConfig.decode" should {
    "tolerantly decode a legacy/unconfigured row without throwing" in {
      noException should be thrownBy ConvertFormatConfig.decode("{}")
      ConvertFormatConfig.decode("{}") shouldBe ConvertFormatConfig("", "", "", "")
    }

    "outputField defaults to field when absent" in {
      ConvertFormatConfig.decode("""{"field":"content","from":"csv","to":"json"}""") shouldBe
        ConvertFormatConfig("content", "csv", "json", "content")
    }

    "outputField is honored when present and distinct" in {
      ConvertFormatConfig.decode("""{"field":"content","from":"csv","to":"json","outputField":"out"}""") shouldBe
        ConvertFormatConfig("content", "csv", "json", "out")
    }
  }

  "ConvertFormatConfig.pairError (write-path)" should {
    "accepts every supported pair" in {
      ConvertFormatStep.SupportedPairs.foreach { case (f, t) =>
        ConvertFormatConfig.pairError(s"""{"field":"c","from":"$f","to":"$t"}""") shouldBe None
      }
    }

    "rejects a cross pair" in {
      ConvertFormatConfig.pairError("""{"field":"c","from":"csv","to":"markdown"}""") shouldBe defined
    }

    "rejects from == to" in {
      ConvertFormatConfig.pairError("""{"field":"c","from":"csv","to":"csv"}""") shouldBe defined
    }

    "does not reject a partially-configured draft (either key absent)" in {
      ConvertFormatConfig.pairError("""{"field":"c","from":"csv"}""") shouldBe None
      ConvertFormatConfig.pairError("""{"field":"c"}""") shouldBe None
      ConvertFormatConfig.pairError("{}") shouldBe None
    }
  }

  "ConvertFormatStep.companion.requiredConfigProblems" should {
    "flags a missing field" in {
      ConvertFormatStep.companion.requiredConfigProblems("""{"from":"csv","to":"json"}""") should not be empty
    }

    "flags an unsupported pair" in {
      val problems = ConvertFormatStep.companion.requiredConfigProblems("""{"field":"c","from":"csv","to":"markdown"}""")
      problems should not be empty
      problems.mkString should include("unsupported from/to pair")
    }

    "is empty for a fully valid config" in {
      ConvertFormatStep.companion.requiredConfigProblems("""{"field":"c","from":"csv","to":"json"}""") shouldBe empty
    }
  }
}
