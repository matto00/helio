package com.helio.services.workspace

import com.helio.services.workspace.WorkspaceContextService
import com.helio.api.JsonProtocols
import com.helio.domain.model.DataField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-373 tasks.md 5.2 — pure unit tests for
 *  `WorkspaceContextService.computeColumnStats`/`asNumeric` (design.md
 *  D2/D3/D4/D5/D6/D8), split into its own file mirroring
 *  `WorkspaceContextServiceSanitizeSampleRowsSpec`'s no-DB-fixture pattern —
 *  `computeColumnStats` is a pure function of its two arguments and touches
 *  none of the service's four constructor dependencies.
 *
 *  Mixes in `JsonProtocols` (HEL-373 skeptic-final-3.md change request 3) so
 *  the serialization-boundary test below can round-trip a real
 *  `columnStats` map through the actual wire format, not just inspect the
 *  Scala domain objects. */
class WorkspaceContextServiceComputeColumnStatsSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val service = new WorkspaceContextService(null, null, null, null)

  private def structuredField(name: String, dataType: String = "string"): DataField =
    DataField(name = name, displayName = name, dataType = dataType, nullable = false)

  "computeColumnStats" should {

    // ── numeric vs. non-numeric ────────────────────────────────────────────

    "report min/max/mean for a numeric column" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsNumber(10)),
        JsObject("amount" -> JsNumber(20)),
        JsObject("amount" -> JsNumber(30))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(10.0)
      stats.max shouldBe Some(30.0)
      stats.mean shouldBe Some(20.0)
    }

    "omit min/max/mean for a non-numeric column" in {
      val fields = Vector(structuredField("status", "string"))
      val rawRows = Vector(
        JsObject("status" -> JsString("active")),
        JsObject("status" -> JsString("inactive"))
      )

      val stats = service.computeColumnStats(fields, rawRows)("status")

      stats.min shouldBe None
      stats.max shouldBe None
      stats.mean shouldBe None
    }

    "report nullRate, distinctCount, and exampleValues for a Structured column" in {
      val fields = Vector(structuredField("status", "string"))
      val rawRows = Vector(
        JsObject("status" -> JsString("active")),
        JsObject("status" -> JsString("inactive")),
        JsObject("status" -> JsNull)
      )

      val stats = service.computeColumnStats(fields, rawRows)("status")

      stats.nullRate shouldBe (1.0 / 3.0)
      stats.distinctCount shouldBe 2
      stats.distinctCountCapped shouldBe false
      stats.exampleValues should contain theSameElementsAs Vector(JsString("active"), JsString("inactive"))
    }

    // ── numeric-declared column holding unparseable strings ────────────────

    "report no min/max/mean and nullRate 0 for a numeric-declared column whose values are all unparseable strings" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsString("n/a")),
        JsObject("amount" -> JsString("n/a"))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe None
      stats.max shouldBe None
      stats.mean shouldBe None
      stats.nullRate shouldBe 0.0
    }

    // ── numeric-declared column holding string-encoded numbers (CSV case) ──

    "compute min/max/mean for a numeric-declared column whose values are string-encoded numbers" in {
      val fields = Vector(structuredField("amount", "integer"))
      val rawRows = Vector(
        JsObject("amount" -> JsString("10")),
        JsObject("amount" -> JsString("20"))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(10.0)
      stats.max shouldBe Some(20.0)
      stats.mean shouldBe Some(15.0)
    }

    "exclude an unparseable value from min/max/mean without counting it as null or zero, on a mixed column" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsString("10")),
        JsObject("amount" -> JsString("not-a-number")),
        JsObject("amount" -> JsNull)
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(10.0)
      stats.max shouldBe Some(10.0)
      stats.mean shouldBe Some(10.0)
      // Only the JsNull counts toward nullRate — the unparseable string is
      // present, just not numeric (design.md D5).
      stats.nullRate shouldBe (1.0 / 3.0)
    }

    // ── HEL-373 skeptic-final-1.md: "NaN"/"Infinity" string literals must be
    //    treated as unparseable garbage, not as successfully-parsed non-finite
    //    doubles (which would otherwise poison mean via math.round and make
    //    min/max wire-serialize to null via a Some(NaN)) ─────────────────────

    "exclude a literal \"NaN\" string cell from min/max/mean like any other unparseable string" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsString("10")),
        JsObject("amount" -> JsString("20")),
        JsObject("amount" -> JsString("NaN"))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(10.0)
      stats.max shouldBe Some(20.0)
      stats.mean shouldBe Some(15.0)
    }

    "exclude literal \"Infinity\"/\"-Infinity\" string cells from min/max/mean like any other unparseable string" in {
      val fields = Vector(structuredField("amount", "integer"))
      val rawRows = (1 to 10).map(i => JsObject("amount" -> JsString(i.toString))).toVector ++
        Vector(JsObject("amount" -> JsString("Infinity")), JsObject("amount" -> JsString("-Infinity")))

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(1.0)
      stats.max shouldBe Some(10.0)
      stats.mean shouldBe Some(5.5)
    }

    // ── HEL-373 skeptic-final-2.md: a genuine JsNumber that overflows to
    //    +-Infinity on .toDouble (large-magnitude BigDecimal) must be excluded
    //    from min/max/mean exactly like an unparseable string — the
    //    round-1 fix only patched the JsString branch; this is the sibling
    //    JsNumber-branch instance of the SAME bug class, now closed by
    //    asNumeric's single exit-point finiteness filter ────────────────────

    "exclude a JsNumber that overflows to +Infinity on .toDouble (1e400) from min/max/mean" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsNumber(10)),
        JsObject("amount" -> JsNumber(20)),
        JsObject("amount" -> JsNumber(BigDecimal("1e400")))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(10.0)
      stats.max shouldBe Some(20.0)
      stats.mean shouldBe Some(15.0)
    }

    // ── HEL-373 skeptic-final-3.md: the ACCUMULATED numericSum can overflow
    //    to +-Infinity even though every individual value fed into it is
    //    legitimately finite (post-asNumeric, already airtight per rounds
    //    1-2) — a different location than asNumeric's own gap, closed by a
    //    finiteness guard at the WorkspaceContextColumnStats construction
    //    site covering min/max/mean together ─────────────────────────────

    "exclude a fabricated mean when the accumulated sum overflows, while min/max stay correct " +
      "(two individually-finite 1e308 values)" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(
        JsObject("amount" -> JsNumber(BigDecimal(1e308))),
        JsObject("amount" -> JsNumber(BigDecimal(1e308)))
      )

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(1e308)
      stats.max shouldBe Some(1e308)
      stats.mean shouldBe None
    }

    // Here the running SUM itself stays finite (499 small addends are
    // negligible next to a single ~1.7e308 outlier) — the true mean IS
    // computable and finite (~3.4e305). The bug this regression pins is
    // narrower and sneakier than a sum overflow: the OLD `math.round(mean *
    // 10000)` rounding technique's own multiply step overflows Double at
    // this magnitude, and `math.round` on a Double at-or-beyond
    // `Long.MaxValue` in magnitude silently CLAMPS to `Long.MaxValue` instead
    // of erroring — fabricating the exact same wrong ~922-trillion value the
    // whole arc has been about eliminating, even though the true mean is a
    // large-but-entirely-legitimate finite number. The fix (BigDecimal-based
    // rounding) must report the genuinely correct huge mean here, not `None`
    // — `None` would be swallowing valid information the caller could use.
    "report a genuinely correct (if very large) mean — not the old fabricated ~922-trillion value — " +
      "when a single near-Double.MaxValue outlier is averaged with 499 otherwise-ordinary rows" in {
      val fields = Vector(structuredField("amount", "float"))
      val ordinaryRows = (1 to 499).map(i => JsObject("amount" -> JsNumber(i)))
      val outlierRow    = JsObject("amount" -> JsNumber(BigDecimal(1.7e308)))
      val rawRows       = (ordinaryRows :+ outlierRow).toVector

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.min shouldBe Some(1.0)
      stats.max shouldBe Some(1.7e308)
      stats.mean shouldBe defined
      stats.mean.get.isFinite shouldBe true
      // Genuinely huge (the mathematically correct order of magnitude given
      // the outlier), NOT the old fabricated Long.MaxValue-derived value.
      stats.mean.get should be > 1e300
      stats.mean.get should not equal 9.223372036854776E14
    }

    // ── HEL-373 skeptic-final-4.md: cross-language rounding tie-break
    //    convention must be identical. Round 4 switched the Scala side's
    //    rounding technique to BigDecimal.setScale(4, HALF_UP) ("round half
    //    AWAY FROM ZERO") but left the TS side on Math.round ("round half
    //    TOWARD +Infinity") — the two conventions disagree ONLY at an exact
    //    binary tie at the 4th decimal place. A mean of exactly -0.00005 is
    //    the skeptic's own reproduction case: HALF_UP rounds to -0.0001;
    //    Math.round's own tie-break rounds to -0/0. This pins the Scala side
    //    (already correct, unchanged this round) to the SAME expected value
    //    the now-fixed TS side must also produce (mirrored in
    //    context.test.ts) — the actual mechanical determinism check design.md
    //    D5/D6 promises, not just prose. ──────────────────────────────────

    "round an exact -0.00005 mean tie AWAY FROM ZERO (to -0.0001), matching the TS side's " +
      "now-aligned tie-break convention" in {
      val fields = Vector(structuredField("amount", "float"))
      val rawRows = Vector(JsObject("amount" -> JsNumber(-0.00005)))

      val stats = service.computeColumnStats(fields, rawRows)("amount")

      stats.mean shouldBe Some(-0.0001)
    }

    // ── all-null column ──────────────────────────────────────────────────

    "report nullRate 1, distinctCount 0, and no min/max for an all-null column" in {
      val fields = Vector(structuredField("notes", "string"))
      val rawRows = Vector(
        JsObject("notes" -> JsNull),
        JsObject() // key absent entirely
      )

      val stats = service.computeColumnStats(fields, rawRows)("notes")

      stats.nullRate shouldBe 1.0
      stats.distinctCount shouldBe 0
      stats.distinctCountCapped shouldBe false
      stats.exampleValues shouldBe empty
      stats.min shouldBe None
      stats.max shouldBe None
    }

    // ── empty snapshot ───────────────────────────────────────────────────

    "produce a non-empty per-column entry with nullRate 0 / distinctCount 0 for an empty rawRows" in {
      val fields = Vector(structuredField("id", "string"), structuredField("amount", "float"))

      val stats = service.computeColumnStats(fields, Vector.empty)

      stats.keySet shouldBe Set("id", "amount")
      stats("id").nullRate shouldBe 0.0
      stats("id").distinctCount shouldBe 0
      stats("id").distinctCountCapped shouldBe false
      stats("id").exampleValues shouldBe empty
      stats("amount").min shouldBe None
    }

    // ── wide DataType column cap (>40 Structured columns) ───────────────

    "cap columnStats columns at the first 40 declared Structured fields, in field order, for a non-empty snapshot" in {
      val fields = (0 until 45).map(i => structuredField(s"col$i")).toVector
      val rawRow = JsObject(fields.map(f => f.name -> JsString(f.name)).toMap)

      val stats = service.computeColumnStats(fields, Vector(rawRow))

      stats.keySet should have size 40
      stats.keySet should contain("col0")
      stats.keySet should contain("col39")
      stats.keySet should not contain "col40"
      stats.keySet should not contain "col44"
    }

    "cap columnStats columns at the first 40 declared Structured fields, in field order, for an empty snapshot" in {
      val fields = (0 until 45).map(i => structuredField(s"col$i")).toVector

      val stats = service.computeColumnStats(fields, Vector.empty)

      stats.keySet should have size 40
      stats.keySet should contain("col0")
      stats.keySet should contain("col39")
      stats.keySet should not contain "col40"
    }

    // ── high-cardinality / distinctCount cap ────────────────────────────

    "report distinctCountCapped true and distinctCount equal to the cap for a high-cardinality column" in {
      val fields = Vector(structuredField("id", "string"))
      val rawRows = (0 until 150).map(i => JsObject("id" -> JsString(s"id-$i"))).toVector

      val stats = service.computeColumnStats(fields, rawRows)("id")

      stats.distinctCountCapped shouldBe true
      stats.distinctCount shouldBe 100
    }

    // ── Content-category exclusion ──────────────────────────────────────

    "have no entry for a Content-category field" in {
      val fields = Vector(structuredField("title"), structuredField("body", "string-body"))
      val rawRow = JsObject("title" -> JsString("doc"), "body" -> JsString("x" * 500))

      val stats = service.computeColumnStats(fields, Vector(rawRow))

      stats.keySet shouldBe Set("title")
    }

    // ── determinism ──────────────────────────────────────────────────────

    "produce identical output (including exampleValues order and mean) across repeated calls over " +
      "the same input" in {
      val fields = Vector(structuredField("amount", "float"), structuredField("status", "string"))
      val rawRows = Vector(
        JsObject("amount" -> JsNumber(3), "status" -> JsString("b")),
        JsObject("amount" -> JsNumber(1), "status" -> JsString("a")),
        JsObject("amount" -> JsNumber(2), "status" -> JsString("a"))
      )

      val first  = service.computeColumnStats(fields, rawRows)
      val second = service.computeColumnStats(fields, rawRows)

      first shouldBe second
      first("status").exampleValues shouldBe second("status").exampleValues
    }

    // ── HEL-373 skeptic-final-3.md change request 3: the invariant asserted
    //    at the SERIALIZATION BOUNDARY, not just the per-field unit level —
    //    the actual property GET /api/workspace/context promises callers.
    //    Constructs a full columnStats slice (multiple columns, including
    //    one whose accumulated sum genuinely overflows) and confirms BOTH
    //    (1) no non-finite Double survives anywhere in the domain map, and
    //    (2) the real wire JSON — round-tripped through the actual
    //    spray-json format, not re-implemented — never contains a literal
    //    "NaN"/"Infinity" token, which the schema's `["number","null"]`
    //    typing alone cannot catch (spray-json silently renders a leaked
    //    non-finite Double as `null`, indistinguishable on the wire from a
    //    legitimately-absent field per round-2's finding) ────────────────

    "assert no non-finite numeric survives anywhere across a full columnStats slice — domain AND wire " +
      "JSON — even when one column's accumulated sum genuinely overflows" in {
      val fields = Vector(
        structuredField("amount", "float"),   // sum overflows: two 1e308 values
        structuredField("score", "integer"),  // ordinary, unaffected numeric column
        structuredField("status", "string")   // non-numeric, no min/max/mean at all
      )
      val rawRows = Vector(
        JsObject("amount" -> JsNumber(BigDecimal(1e308)), "score" -> JsNumber(10), "status" -> JsString("a")),
        JsObject("amount" -> JsNumber(BigDecimal(1e308)), "score" -> JsNumber(20), "status" -> JsString("b"))
      )

      val columnStats = service.computeColumnStats(fields, rawRows)

      // (1) Domain-level invariant, across the WHOLE slice, not just one field.
      val allNumericValues: Vector[Double] =
        columnStats.values.toVector.flatMap(cs => cs.min ++ cs.max ++ cs.mean)
      allNumericValues should not be empty // sanity: this slice actually has numeric fields
      allNumericValues.forall(_.isFinite) shouldBe true

      // Confirm the specific overflowing column's own contract: min/max
      // survive correctly, mean is excluded — not silently swapped for the
      // OTHER column's data, not a fabricated cross-column value.
      columnStats("amount").min shouldBe Some(1e308)
      columnStats("amount").max shouldBe Some(1e308)
      columnStats("amount").mean shouldBe None
      columnStats("score").mean shouldBe Some(15.0)

      // (2) Wire-level invariant: round-trip through the REAL spray-json
      // format (workspaceContextColumnStatsFormat's Map instance, summoned
      // via JsonProtocols), not a hand-rolled JSON check.
      val wireJson = columnStats.toJson.compactPrint
      wireJson should not include "NaN"
      wireJson should not include "Infinity"
    }
  }

  /** HEL-373 skeptic-final-2.md's binding requirement 3: "exhaustive
   *  table-driven tests over `asNumeric`'s entire input space, both sides —
   *  not one case bolted on." Every case below pins the exact expected
   *  `Option[Double]` for one representative of each input class `asNumeric`
   *  can ever see — after this, no reviewer should be able to find an
   *  `asNumeric` input whose behavior isn't covered by a test. */
  "asNumeric" should {
    val cases: Vector[(String, JsValue, Option[Double])] = Vector(
      ("a finite JsNumber", JsNumber(42), Some(42.0)),
      ("a JsNumber that overflows to +Infinity on .toDouble (1e400)", JsNumber(BigDecimal("1e400")), None),
      ("a JsNumber that overflows to -Infinity on .toDouble (-1e400)", JsNumber(BigDecimal("-1e400")), None),
      ("the literal \"NaN\" string", JsString("NaN"), None),
      ("the literal \"Infinity\" string", JsString("Infinity"), None),
      ("the literal \"-Infinity\" string", JsString("-Infinity"), None),
      ("a valid numeric string", JsString("42"), Some(42.0)),
      ("a valid numeric string with surrounding whitespace", JsString("  10.5  "), Some(10.5)),
      ("an empty string", JsString(""), None),
      ("a whitespace-only string", JsString("   "), None),
      ("a non-numeric string", JsString("n/a"), None),
      ("a JsBoolean", JsBoolean(true), None),
      ("a JsObject", JsObject("k" -> JsString("v")), None),
      ("a JsArray", JsArray(Vector(JsNumber(1))), None),
      ("JsNull", JsNull, None)
    )

    cases.foreach { case (description, input, expected) =>
      s"return $expected for $description" in {
        service.asNumeric(input) shouldBe expected
      }
    }
  }
}
