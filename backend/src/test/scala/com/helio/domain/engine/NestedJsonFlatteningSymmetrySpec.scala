package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.io.Source

/** HEL-599 design.md D7 — the verification a flat fixture cannot fake.
 *
 *  1. Symmetry (task 5.2): for a single row object, the field-name set
 *     `SchemaInferenceEngine` infers must EQUAL the column-key set `PipelineRowJson.jsRowToRow`
 *     materialises. Deliberately scoped PER ROW OBJECT — a whole-array assertion under this exact
 *     equality relation would have failed against a *correct* implementation pre-HEL-858 (the old
 *     `mergeObjects` first-non-null-wins / `withNulls` residual), AND it still fails, deliberately,
 *     against the post-HEL-858 implementation: `inferFromObjects` unions leaf paths across every
 *     sampled row, so the schema legitimately carries fields no single row has (a QB row has no
 *     `stats.rec`, but the schema does) — see design D6, which names this naive whole-array
 *     equality WRONG for exactly that reason. The per-row scope above stays correct and unchanged.
 *     The relation that DOES hold whole-array post-HEL-858 is D6's three-sided subset + union +
 *     no-duplicates property, a different assertion from the equality here — asserted separately
 *     in `SchemaInferenceEngineSpec`'s `assertAgreement` tests (3.8a/3.8b), not in this file.
 *  2. Negative control (task 5.3): the pre-fix shape must be gone — no column whose value is
 *     JSON text starting with `{`, and no top-level `stats`/`player` column coexisting with its
 *     own dotted children.
 *  3. Real-payload fixture (task 5.4): a verbatim, unmodified capture of a live Sleeper
 *     projections response slice (`hel599/sleeper-wr-projections-slice.json`), including the
 *     third-level `player.metadata` key so multi-level nesting is exercised by real data — not
 *     hand-written, per design D7.3.
 *  4. Type correctness (task 5.5): `stats.pts_ppr` materialises as a numeric value matching the
 *     `float`/`integer` type the schema infers, and `player.first_name` as a string.
 */
class NestedJsonFlatteningSymmetrySpec extends AnyWordSpec with Matchers {

  private val rows: Vector[JsObject] = {
    val text = Source.fromResource("hel599/sleeper-wr-projections-slice.json").mkString
    text.parseJson.asInstanceOf[JsArray].elements.collect { case o: JsObject => o }
  }

  private def inferredFieldNames(rowObj: JsObject): Set[String] =
    SchemaInferenceEngine.fromJson(rowObj).fields.map(_.name).toSet

  private def materialisedColumnKeys(rowObj: JsObject): Set[String] =
    PipelineRowJson.jsRowToRow(rowObj).keySet

  "schema/row symmetry over a genuinely nested Sleeper row" should {
    "produce the identical field-name set as the materialised column-key set, for every captured row" in {
      rows should not be empty
      rows.foreach { rowObj =>
        inferredFieldNames(rowObj) shouldBe materialisedColumnKeys(rowObj)
      }
    }

    "actually exercise nesting (sanity: the fixture must contain dotted fields, or this test proves nothing)" in {
      val names = inferredFieldNames(rows.head)
      names.exists(_.startsWith("stats.")) shouldBe true
      names.exists(_.startsWith("player.")) shouldBe true
      // Third-level nesting via player.metadata, per design D7.3 / task 5.4.
      names.exists(_.startsWith("player.metadata.")) shouldBe true
    }
  }

  "negative control" should {
    "leaves no column whose value is JSON object text (the pre-fix shape)" in {
      rows.foreach { rowObj =>
        val materialised = PipelineRowJson.jsRowToRow(rowObj)
        materialised.values.foreach {
          case s: String => s.trim.startsWith("{") shouldBe false
          case _          => // fine
        }
      }
    }

    "does not carry a top-level 'stats' or 'player' column alongside its dotted children" in {
      rows.foreach { rowObj =>
        val keys = PipelineRowJson.jsRowToRow(rowObj).keySet
        keys should not contain "stats"
        keys should not contain "player"
        keys.exists(_.startsWith("stats.")) shouldBe true
        keys.exists(_.startsWith("player.")) shouldBe true
      }
    }
  }

  "type correctness" should {
    "materialises stats.pts_ppr as a numeric value matching the schema's inferred numeric type" in {
      val rowObj  = rows.head
      val schema  = SchemaInferenceEngine.fromJson(rowObj)
      val field   = schema.fields.find(_.name == "stats.pts_ppr").getOrElse(fail("stats.pts_ppr missing from inferred schema"))
      field.dataType should (be(DataFieldType.FloatType) or be(DataFieldType.IntegerType))

      val row = PipelineRowJson.jsRowToRow(rowObj)
      row("stats.pts_ppr") shouldBe a[java.lang.Double]
    }

    "materialises player.first_name as a string, not as flattened JSON text" in {
      val rowObj = rows.head
      val row    = PipelineRowJson.jsRowToRow(rowObj)
      row("player.first_name") shouldBe a[String]
      row("player.first_name").asInstanceOf[String] should not startWith "{"
    }
  }
}
