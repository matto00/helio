package com.helio.services.panels

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.LayoutPolicy.Patch
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** The write policy (HEL-1071): identical-to-stored passes untouched, absent is preserved, a changed
 *  breakpoint must be fully valid or the whole write is rejected. */
class LayoutPolicySpec extends AnyWordSpec with Matchers {

  private def item(id: String, x: Int, y: Int, w: Int = 1, h: Int = 2) = DashboardLayoutItem(PanelId(id), x, y, w, h)

  private val storedBadXs = Vector(item("a", 0, 0), item("b", 0, 0)) // same cell
  private val stored = DashboardLayout(
    lg = Vector(item("a", 0, 0, 6), item("b", 6, 0, 6)),
    md = Vector.empty,
    sm = Vector.empty,
    xs = storedBadXs
  )

  "sameItems" should {
    "ignore array order" in {
      LayoutPolicy.sameItems(storedBadXs, storedBadXs.reverse) shouldBe true
    }
    "count duplicates (a multiset, not a set)" in {
      LayoutPolicy.sameItems(Vector(item("a", 0, 0), item("a", 0, 0)), Vector(item("a", 0, 0))) shouldBe false
      LayoutPolicy.sameItems(Vector(item("a", 0, 0), item("a", 0, 0), item("b", 1, 0)), Vector(item("a", 0, 0), item("b", 1, 0), item("b", 1, 0))) shouldBe false
    }
    "see one differing coordinate, and an extra or missing item" in {
      LayoutPolicy.sameItems(storedBadXs, Vector(item("a", 0, 0), item("b", 0, 1))) shouldBe false
      LayoutPolicy.sameItems(storedBadXs, storedBadXs :+ item("c", 1, 4)) shouldBe false
      LayoutPolicy.sameItems(storedBadXs, storedBadXs.tail) shouldBe false
    }
  }

  "LayoutPolicy.apply" should {
    "pass a stored-bad breakpoint through untouched when the caller re-sends it (reordered), while changed lg is applied" in {
      val newLg = Vector(item("a", 0, 0, 6), item("b", 6, 2, 6))
      val patch = Patch(lg = Some(newLg), xs = Some(storedBadXs.reverse))
      val Right(merged) = LayoutPolicy(stored, patch)
      merged.lg shouldBe newLg
      merged.xs shouldBe storedBadXs // stored order retained, byte-identical
    }

    "preserve absent breakpoints exactly" in {
      val Right(merged) = LayoutPolicy(stored, Patch(md = Some(Vector(item("a", 0, 0, 5)))))
      merged.lg shouldBe stored.lg
      merged.sm shouldBe stored.sm
      merged.xs shouldBe stored.xs
      merged.md shouldBe Vector(item("a", 0, 0, 5))
    }

    "reject a changed breakpoint that is still overlapping, naming the breakpoint and both ids" in {
      val Left(msg) = LayoutPolicy(stored, Patch(xs = Some(Vector(item("a", 0, 0), item("b", 0, 1)))))
      msg should include("breakpoint 'xs'")
      msg should include("'a'")
      msg should include("'b'")
      msg should include("overlap")
    }

    "reject an out-of-bounds changed breakpoint and name the panel" in {
      val Left(msg) = LayoutPolicy(stored, Patch(xs = Some(Vector(item("a", 1, 0, 2)))))
      msg should include("breakpoint 'xs'")
      msg should include("panel 'a' is out of bounds")
    }

    "reject the whole write when one breakpoint is bad: the valid lg is not applied either" in {
      val Left(_) = LayoutPolicy(stored, Patch(lg = Some(Vector(item("a", 0, 5, 6))), xs = Some(Vector(item("a", 0, 0), item("b", 0, 0, 1, 1)))))
    }

    "accept a repaired breakpoint and not clamp or alter it" in {
      val repaired = Vector(item("b", 1, 0), item("a", 0, 0))
      val Right(merged) = LayoutPolicy(stored, Patch(xs = Some(repaired)))
      merged.xs shouldBe repaired
    }

    "report breakpoints in lg, md, sm, xs order and cap the message at 10 violations" in {
      val bad = (1 to 12).toVector.map(i => item(s"p$i", 0, 0, 20)) // every item out of bounds in lg
      val Left(msg) = LayoutPolicy(stored, Patch(lg = Some(bad)))
      msg should startWith("Layout rejected: breakpoint 'lg'")
      msg should include("and")
      msg should endWith("more")
      msg.split("out of bounds").length - 1 shouldBe 10
    }
  }

  "LayoutPolicy.applyUnvalidated" should {
    "write a stored-bad prior value back (the rollback/undo restore path)" in {
      val prior  = DashboardLayout(Vector.empty, Vector.empty, Vector.empty, Vector(item("a", 1, 0, 2), item("b", 1, 0, 2)))
      val merged = LayoutPolicy.applyUnvalidated(stored.copy(xs = Vector.empty), Patch.full(prior))
      merged.xs shouldBe prior.xs
    }
  }
}
