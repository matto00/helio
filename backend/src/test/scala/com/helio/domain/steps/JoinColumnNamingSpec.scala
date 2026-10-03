package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1236: the pure collision rule (`JoinColumnNaming.resolve`): right column -> output name for
 *  every SURVIVING right column; the dropped duplicate join key is absent from the result. */
class JoinColumnNamingSpec extends AnyWordSpec with Matchers {
  import JoinColumnNaming.resolve

  "JoinColumnNaming.resolve" should {
    "keep a non-colliding right column's name" in {
      resolve(Seq("id", "a"), Seq("id", "b"), "id") shouldBe Map("b" -> "b")
    }

    "prefix a single colliding right column" in {
      resolve(Seq("id", "cnt"), Seq("id", "cnt"), "id") shouldBe Map("cnt" -> "right_cnt")
    }

    "prefix several colliding columns" in {
      resolve(Seq("id", "a", "b"), Seq("id", "a", "b", "c"), "id") shouldBe
        Map("a" -> "right_a", "b" -> "right_b", "c" -> "c")
    }

    "drop the right copy of the join key when both sides carry it (kept once, from the left)" in {
      resolve(Seq("id"), Seq("id"), "id") shouldBe Map.empty
    }

    "keep the right join key when the left side does not carry it" in {
      resolve(Seq("a"), Seq("id", "b"), "id") shouldBe Map("id" -> "id", "b" -> "b")
    }

    "skip a name already taken on the left: right_x on the left -> right_x_2" in {
      resolve(Seq("id", "x", "right_x"), Seq("id", "x"), "id") shouldBe Map("x" -> "right_x_2")
    }

    "never land on a real right-side column: right_x on the right is kept, x -> right_x_2" in {
      resolve(Seq("id", "x"), Seq("id", "x", "right_x"), "id") shouldBe Map("x" -> "right_x_2", "right_x" -> "right_x")
    }

    "count up past several taken suffixes" in {
      resolve(Seq("id", "x", "right_x", "right_x_2"), Seq("id", "x", "right_x_3"), "id") shouldBe
        Map("x" -> "right_x_4", "right_x_3" -> "right_x_3")
    }

    "resolve renames that would clash with each other in ascending name order, independent of input order" in {
      // "a" -> right_a is taken on the left, so "a" -> right_a_2; "a_2" -> right_a_2 would clash.
      val left = Seq("id", "a", "a_2", "right_a")
      val one  = resolve(left, Seq("id", "a", "a_2"), "id")
      val two  = resolve(left, Seq("id", "a_2", "a"), "id")
      one shouldBe two
      one shouldBe Map("a" -> "right_a_2", "a_2" -> "right_a_2_2")
      one.values.toSet should have size one.size
    }

    "pin the spec scenario: left and right both {a, a_2, right_a} resolve in sorted-name order" in {
      val cols = Seq("id", "a", "a_2", "right_a")
      val expected = Map("a" -> "right_a_2", "a_2" -> "right_a_2_2", "right_a" -> "right_right_a")
      resolve(cols, cols, "id") shouldBe expected
      resolve(cols, cols.reverse, "id") shouldBe expected
    }

    "never rename or drop a left column (output names are all distinct from the left names)" in {
      val left  = Seq("id", "a", "b", "right_a")
      val right = Seq("id", "a", "b", "right_a", "z")
      val out   = resolve(left, right, "id")
      out.values.toSet.intersect(left.toSet) shouldBe empty
      out.values.toSet should have size out.size
    }
  }
}
