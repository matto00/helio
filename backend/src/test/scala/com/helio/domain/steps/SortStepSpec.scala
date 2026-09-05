package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-893 tasks.md 6.4 — regression guard for the shape a CSV source actually produces: a
 *  column of numeric-looking `String`s. Under HEL-893's design, every CSV column materializes
 *  as a `String` unconditionally (`InProcessPipelineEngine.loadCsvRowsFromBytes`), so a sort
 *  over such a column is a real, common case that no prior test covered. `SortStep` coerces via
 *  `PipelineRowJson.toDouble`'s `case s: String => s.toDoubleOption` branch when BOTH sides
 *  parse as numbers, so `"9" < "10" < "100"` sorts numerically rather than lexicographically
 *  (which would order "10" < "100" < "9"). */
class SortStepSpec extends AnyWordSpec with Matchers {

  private def key(field: String, direction: String = "asc"): SortKey = SortKey(field, direction)

  // HEL-981: the mixed value set exercised by the contract guards below (2.1-2.3). Includes
  // numbers, numeric-looking strings, non-coercible strings, "NaN"/Double.NaN, "Infinity",
  // nulls, and duplicates of each -- design.md Risks (NaN must land in tier 2, not tier 1: a
  // cell that only looks numeric but coerces to NaN/Infinity is junk data, not a magnitude the
  // user meant to rank, so ranking it among real numbers would be nonsensical -- a
  // data-semantics choice, not a transitivity requirement; see mutation-evidence.md Mutation D).
  private val mixedValues: Vector[Any] = Vector(
    1,
    1,
    9,
    "9",
    10,
    "10",
    100,
    "n/a",
    "n/a",
    "zzz",
    "NaN",
    Double.NaN,
    "Infinity",
    null,
    null
  )

  /** Sort-key equivalence class: tier 1 (finite numeric) values keyed by magnitude, tier 2
   *  (everything else non-null) keyed by string form, nulls their own class. Mirrors
   *  `SortStep`'s own tiering (design.md D4a) so 2.6 can assert on equivalence classes rather
   *  than raw value identity. */
  private def equivClass(v: Any): Either[String, Either[Double, String]] = v match {
    case null                                             => Left("null")
    case i: Int if i.toDouble.isFinite                    => Right(Left(i.toDouble))
    case d: Double if d.isFinite                          => Right(Left(d))
    case s: String if s.toDoubleOption.exists(_.isFinite) => Right(Left(s.toDouble))
    case other                                            => Right(Right(other.toString))
  }

  private def rowsOf(values: Seq[Any]): Seq[Map[String, Any]] = values.map(v => Map("v" -> v))

  private def sortedValues(values: Seq[Any], direction: String = "asc"): Seq[Any] =
    SortStep.apply(rowsOf(values), SortConfig(Vector(key("v", direction)))).map(_("v"))

  /** Whether `x` strictly precedes `y` under `SortStep.apply`'s ACTUAL pairwise comparator
   *  (not a reimplementation of it) -- i.e. sorting the two-element sequence `[x, y]` moves `x`
   *  ahead of `y`. Used by 2.2/2.3 so those guards observe the real comparator's relation
   *  rather than a hand-built model that could pass independently of any mutation. */
  private def strictlyBefore(x: Any, y: Any, direction: String): Boolean =
    // x == y (the same value, e.g. two literal 9s) can never be "strictly before" itself --
    // guard that case explicitly, since sorting [x, x] and [x, x] both trivially "look like"
    // [x, y] and would otherwise be misread as a strict order.
    x != y && sortedValues(Seq(x, y), direction) == Seq(x, y) && sortedValues(
      Seq(y, x),
      direction
    ) == Seq(x, y)

  "SortStep.apply" should {

    "sorts numeric-looking String values numerically, not lexicographically (HEL-893)" in {
      val rows = Seq(
        Map("n" -> "10"),
        Map("n" -> "9"),
        Map("n" -> "100")
      )
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n"))))
      sorted.map(_("n")) shouldBe Seq("9", "10", "100")

      // A lexicographic sort of the same three strings would instead produce
      // "10", "100", "9" -- pin the contrast so the guard fails if the numeric
      // coercion regresses to string comparison.
      sorted.map(_("n")) should not be Seq("10", "100", "9")
    }

    "sorts numeric-looking String values descending, numerically" in {
      val rows = Seq(Map("n" -> "9"), Map("n" -> "100"), Map("n" -> "10"))
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n", "desc"))))
      sorted.map(_("n")) shouldBe Seq("100", "10", "9")
    }

    "is irreflexive over a mixed value set (HEL-981 2.1)" in {
      for {
        direction <- Seq("asc", "desc")
        v         <- mixedValues
      } {
        val rows   = rowsOf(Seq(v, v))
        val sorted = SortStep.apply(rows, SortConfig(Vector(key("v", direction))))
        // A single value never strictly precedes an equal copy of itself: the two-element
        // sort must leave both copies present, i.e. never "lose" one via a false `<`/`>` on
        // equal inputs.
        sorted.map(_("v")) should contain theSameElementsAs rows.map(_("v"))
      }
    }

    "is antisymmetric over all pairs of the mixed value set, permitting equivalence (HEL-981 2.2)" in {
      for {
        direction <- Seq("asc", "desc")
        x         <- mixedValues
        y         <- mixedValues
      } {
        // If x strictly precedes y and y strictly precedes x under the SAME direction, that
        // is a contradiction (equivalent values may appear in either order via stability --
        // that is not "both directions strictly disagree").
        (strictlyBefore(x, y, direction) && strictlyBefore(y, x, direction)) shouldBe false
      }
    }

    "is transitive over all triples of the mixed value set, in both directions (HEL-981 2.3)" in {
      // Observes SortStep.apply's ACTUAL pairwise relation (via strictlyBefore) rather than a
      // hand-built model of the intended tiering -- a model reimplementation could pass
      // independently of whatever the comparator under test actually does. Also proves
      // transitivity of equivalence: if x~y and y~z (neither strictly precedes the other in
      // either pairing) then x~z, checked directly below.
      for {
        direction <- Seq("asc", "desc")
        x         <- mixedValues
        y         <- mixedValues
        z         <- mixedValues
      } {
        if (strictlyBefore(x, y, direction) && strictlyBefore(y, z, direction)) {
          withClue(s"x=$x y=$y z=$z direction=$direction: ") {
            strictlyBefore(x, z, direction) shouldBe true
          }
        }
        def equiv(a: Any, b: Any): Boolean = !strictlyBefore(a, b, direction) && !strictlyBefore(b, a, direction)
        if (equiv(x, y) && equiv(y, z)) {
          withClue(s"x=$x y=$y z=$z direction=$direction (equivalence): ") {
            equiv(x, z) shouldBe true
          }
        }
      }
    }

    "keeps the ticket's exact repro's numeric values in numeric order (HEL-981 2.4)" in {
      val rows = Seq(Map("n" -> 10), Map("n" -> 9), Map("n" -> "n/a"))
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n"))))
      sorted.map(_("n")) shouldBe Seq(9, 10, "n/a")
    }

    "reverses tiers when descending, with a null still last (HEL-981 2.5)" in {
      val rows = Seq(Map("n" -> 9), Map("n" -> null), Map("n" -> "n/a"), Map("n" -> 10))
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n", "desc"))))
      sorted.map(_("n")) shouldBe Seq("n/a", 10, 9, null)
    }

    "produces the same sort-key equivalence-class sequence regardless of input order (HEL-981 2.6)" in {
      // This fixture DOES contain a cross-type equal pair (9 / "9"), so per design.md D4a the
      // assertion is on the sort-key equivalence-class sequence, not the raw value sequence.
      val values      = Vector(10, 9, "9", "n/a", null, "zzz")
      val permutation = Vector("9", 9, "n/a", null, 10, "zzz")

      val sortedA = sortedValues(values)
      val sortedB = sortedValues(permutation)

      // Pin the expected equivalence-class sequence explicitly (numeric tier first, then
      // non-coercible lexicographic, then null last) so this guard discriminates the shipped
      // numeric-tier-first ordering from the rejected alternatives, not just checks the two
      // runs agree with each other (which any deterministic comparator would satisfy).
      val expected = Seq(9, "9", 10, "n/a", "zzz", null).map(equivClass)
      sortedA.map(equivClass) shouldBe expected
      sortedB.map(equivClass) shouldBe expected
    }

    "sorts \"NaN\" and \"Infinity\" as non-coercible tier-2 values, not as numbers (HEL-981 2.7)" in {
      // "0aa" is deliberately chosen to sort BEFORE "Infinity"/"NaN" lexicographically
      // (tier-2 order) but AFTER 5.0/Infinity/NaN under java.lang.Double.compare's total
      // order (tier-membership-blind order) -- without it, this fixture is degenerate:
      // {5, "NaN", "Infinity", "n/a"} happens to land in the same sequence whether or not
      // "NaN"/"Infinity" are classified into tier 1 or tier 2, so it cannot discriminate
      // whether the `.filter(_.isFinite)` tier-membership exclusion is actually in effect.
      val rows = Seq(
        Map("n" -> 5),
        Map("n" -> "NaN"),
        Map("n" -> "Infinity"),
        Map("n" -> "0aa"),
        Map("n" -> "n/a")
      )
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n"))))
      sorted.map(_("n")) shouldBe Seq(5, "0aa", "Infinity", "NaN", "n/a")
    }
  }
}
