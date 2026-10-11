package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.CreateDashboardRequest
import com.helio.api.protocols.patchsets.{Edit, EditTarget}
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import PatchSetApplyServiceJson._

/** HEL-1482 items 5-6: the user-facing `BadRequest` texts of `PatchSetResolverSupport.requireTargetId` and
 *  `decodeCreatePatch`, which no spec asserted (a changed literal, status or index interpolation left
 *  every test green). The helpers are pure and run before any repository is touched, so they are driven
 *  directly (no database): `resolveAll` reaches them first for every kind, and its callers only
 *  forward the `Left`. A non-zero edit index is used throughout so the `edit <i>:` prefix is pinned. */
class PatchSetResolverMessagesSpec extends AnyWordSpec with Matchers {

  private def edit(op: String, id: Option[String], createPatch: Option[JsValue] = None): Edit =
    Edit(EditTarget("dashboard", id), op, None, None, None, None, None, createPatch)

  "PatchSetResolverSupport.requireTargetId" should {

    "return the trimmed id when one is present" in {
      PatchSetResolverSupport.requireTargetId(edit("update", Some("  d-1 ")), 1) shouldBe Right("d-1")
    }

    "reject an absent target.id with the op and the edit index in the message" in {
      PatchSetResolverSupport.requireTargetId(edit("update", None), 1) shouldBe
        Left(ServiceError.BadRequest("edit 1: target.id is required for op 'update'"))
    }

    "reject a blank target.id the same way, naming the delete op" in {
      PatchSetResolverSupport.requireTargetId(edit("delete", Some("   ")), 2) shouldBe
        Left(ServiceError.BadRequest("edit 2: target.id is required for op 'delete'"))
    }
  }

  "PatchSetResolverSupport.decodeCreatePatch" should {

    "decode a well-formed create patch" in {
      val e = edit("create", None, Some(JsObject("name" -> JsString("New"))))
      PatchSetResolverSupport.decodeCreatePatch[CreateDashboardRequest](e, 1) shouldBe Right(CreateDashboardRequest(Some("New")))
    }

    "reject a create edit with no patch, naming the edit index" in {
      PatchSetResolverSupport.decodeCreatePatch[CreateDashboardRequest](edit("create", None), 1) shouldBe
        Left(ServiceError.BadRequest("edit 1: patch is required for a create edit"))
    }

    "reject a patch that does not decode to the expected shape, as a BadRequest naming the edit index" in {
      val e = edit("create", None, Some(JsObject("name" -> JsNumber(7))))
      PatchSetResolverSupport.decodeCreatePatch[CreateDashboardRequest](e, 1) match {
        case Left(ServiceError.BadRequest(msg)) => msg should startWith("edit 1: patch does not match the expected shape (")
        case other                                => fail(s"expected a BadRequest, got $other")
      }
    }
  }
}
