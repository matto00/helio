package com.helio.services.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1705 H: the one ordering rule behind every rows read path. */
class RowColumnOrderSpec extends AnyWordSpec with Matchers {

  private val schema = Vector("zeta", "10", "alpha")
  private def row(keys: String*): JsObject = JsObject(keys.map(_ -> (JsNumber(1): JsValue)).toMap)

  "RowColumnOrder" should {
    "print schema names first, then the other keys in code-point order" in {
      val ordered = RowColumnOrder.orderRow(schema, row("alpha", "b", "10", "Z", "zeta"))
      ordered.compactPrint shouldBe """{"zeta":1,"10":1,"alpha":1,"Z":1,"b":1}"""
    }

    "list only the schema names a page's rows carry, then the page's extras" in {
      RowColumnOrder.columns(schema, Vector(row("alpha", "x"), row("zeta", "b"))) shouldBe Vector("zeta", "alpha", "b", "x")
    }

    "list every schema name for an empty page" in {
      RowColumnOrder.columns(schema, Vector.empty) shouldBe schema
    }

    "keep ordering past four keys (a plain JsObject(pairs) would lose it)" in {
      val keys = Vector("k9", "k1", "k5", "k3", "k7", "k2")
      RowColumnOrder.orderRow(keys, row(keys: _*)).compactPrint should startWith("""{"k9":1,"k1":1,"k5":1,"k3":1,"k7":1,"k2":1}""")
    }
  }
}
