package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-599 design.md D7/task 5.1: unit coverage for the shared traversal itself, independent of
 *  either projection (schema inference / row materialisation). */
class JsonFlattenerSpec extends AnyWordSpec with Matchers {

  "JsonFlattener.leaves" should {

    "flatten a nested object into dotted leaves and drop the parent key" in {
      val obj = JsObject(
        "player_id" -> JsString("8800"),
        "stats"     -> JsObject("pts_ppr" -> JsNumber(33.7), "rec" -> JsNumber(6))
      )
      val result = JsonFlattener.leaves(obj).toMap

      result.keySet shouldBe Set("player_id", "stats.pts_ppr", "stats.rec")
      result should not contain key("stats")
    }

    "flatten multi-level nesting" in {
      val obj = JsObject(
        "player" -> JsObject(
          "metadata" -> JsObject("team" -> JsString("DAL"), "active" -> JsBoolean(true))
        )
      )
      val result = JsonFlattener.leaves(obj).toMap
      result.keySet shouldBe Set("player.metadata.team", "player.metadata.active")
      result("player.metadata.team") shouldBe JsString("DAL")
    }

    "leave top-level scalars unchanged" in {
      val obj = JsObject("a" -> JsNumber(1), "b" -> JsString("x"), "c" -> JsBoolean(false))
      JsonFlattener.leaves(obj).toMap shouldBe Map(
        "a" -> JsNumber(1),
        "b" -> JsString("x"),
        "c" -> JsBoolean(false)
      )
    }

    "contribute nothing for an empty nested object" in {
      val obj = JsObject("a" -> JsNumber(1), "empty" -> JsObject.empty)
      JsonFlattener.leaves(obj).toMap shouldBe Map("a" -> JsNumber(1))
    }

    "treat an array of scalars as a single leaf, no index paths" in {
      val obj = JsObject("tags" -> JsArray(JsString("x"), JsString("y")))
      val result = JsonFlattener.leaves(obj)
      result should have size 1
      result.head._1 shouldBe "tags"
      result.head._2 shouldBe a[JsArray]
    }

    "treat an array of objects as a single leaf, no index paths" in {
      val obj = JsObject(
        "games" -> JsArray(JsObject("pts" -> JsNumber(1)), JsObject("pts" -> JsNumber(2)))
      )
      val result = JsonFlattener.leaves(obj)
      result should have size 1
      result.head._1 shouldBe "games"
      result.head._2 shouldBe a[JsArray]
    }

    "treat an array nested inside an object as a leaf at its own dotted path" in {
      val obj = JsObject("stats" -> JsObject("history" -> JsArray(JsNumber(1), JsNumber(2))))
      val result = JsonFlattener.leaves(obj).toMap
      result.keySet shouldBe Set("stats.history")
    }

    "treat an object at the depth bound as a leaf rather than recursing further" in {
      // Build a chain of exactly MaxDepth "n" wrappers around a scalar leaf. Walking this input
      // puts the object AT the bound exactly at path "n" repeated MaxDepth times -- one level
      // deeper (a real scalar field) would otherwise be reachable were the bound not enforced.
      def nest(depth: Int): JsObject =
        if (depth == 0) JsObject("leafField" -> JsNumber(1))
        else JsObject("n" -> nest(depth - 1))

      val obj = nest(JsonFlattener.MaxDepth)
      val result = JsonFlattener.leaves(obj)

      // Final-gate skeptic round 1: the prior version of this test only asserted non-emptiness
      // and a path prefix, which would pass unchanged for ANY MaxDepth (including one that
      // silently truncated the path, or a bound of 1 or 100). Pin the actual behaviour instead:
      // exactly MaxDepth "n" segments, the leaf value is still the untouched JsObject subtree
      // (not descended into further, not truncated), and downstream both projections treat it
      // as a StringType/compact-JSON leaf exactly like an array (design D3).
      result should have size 1
      val (path, leafValue) = result.head
      path.split("\\.").toVector shouldBe Vector.fill(JsonFlattener.MaxDepth)("n")
      leafValue shouldBe JsObject("leafField" -> JsNumber(1)) // the untouched subtree AT the bound

      // Row materialisation: the leaf's compact JSON text, not a further-flattened dotted column.
      val rowValue = PipelineRowJson.jsRowToRow(obj)
      rowValue.keySet shouldBe Set(path)
      rowValue(path) shouldBe a[String]
      rowValue(path).asInstanceOf[String] should include(""""leafField":1""")

      // Schema inference: typed as StringType at the same path, matching the row exactly.
      val schema = SchemaInferenceEngine.fromJson(obj)
      schema.fields.map(_.name) shouldBe Seq(path)
      schema.fields.head.dataType shouldBe DataFieldType.StringType
    }

    "not error and not drop any top-level column for input far beyond the bound" in {
      def nest(depth: Int): JsObject =
        if (depth == 0) JsObject("x" -> JsNumber(1)) else JsObject("n" -> nest(depth - 1))

      val obj = JsObject("a" -> JsNumber(1), "deep" -> nest(50))
      val result = JsonFlattener.leaves(obj).toMap
      result should contain key "a"
      result.keySet.exists(_.startsWith("deep")) shouldBe true
    }

    "resolve a dotted-key collision deterministically, the same way on every call" in {
      // {"a.b": 1, "a": {"b": 2}} — both generate path "a.b". Which one wins depends on the
      // underlying JsObject's own (unordered) field iteration order — design D4 deliberately
      // does not pin a specific winner for pathological input with no correct answer — but that
      // winner must be STABLE: repeated calls over the same input must agree, never flap.
      //
      // Final-gate skeptic round 1: `leaves` itself must return exactly one pair for the
      // colliding path -- NOT merely "one pair after the test folds it into a Map". A prior
      // version of this test asserted on `leaves(obj).toMap`, which hid a real bug: the
      // un-deduplicated `Seq` `leaves` returned had TWO `"a.b"` entries, and
      // `SchemaInferenceEngine.flattenObject` (which builds its `InferredField` `Seq` directly
      // from `leaves`, never folding it into a `Map`) shipped that duplicate straight into the
      // inferred schema. So this test now asserts directly on the raw `Seq` `leaves` returns.
      val obj = JsObject("a.b" -> JsNumber(1), "a" -> JsObject("b" -> JsNumber(2)))
      val results = (1 to 20).map(_ => JsonFlattener.leaves(obj))
      results.foreach { leaves =>
        leaves should have size 1 // exactly one "a.b" pair in the raw Seq itself, not just after a Map fold
        leaves.head._1 shouldBe "a.b"
      }
      results.map(_.head._2).toSet should have size 1 // one consistent winning value across repeated calls
    }
  }

  "JsonFlattener.flattenJsObject" should {
    "reassemble leaves into a flat JsObject" in {
      val obj = JsObject("stats" -> JsObject("pts_ppr" -> JsNumber(33.7)))
      JsonFlattener.flattenJsObject(obj) shouldBe JsObject("stats.pts_ppr" -> JsNumber(33.7))
    }
  }
}
