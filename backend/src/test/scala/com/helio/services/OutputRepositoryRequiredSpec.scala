package com.helio.services

import com.helio.services.panels.OutputControlsValidator
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService, PatchSetUndoService}
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.ExecutionContext

/** HEL-1337: every service that takes an `OutputRepository` asserts it non-null at construction
 *  (HEL-1295's pattern, `PanelServiceOutputBindingSpec`), so a null repo fails loudly and by name
 *  instead of degrading silently or NPE-ing mid-request. No DB: construction alone must throw. */
class OutputRepositoryRequiredSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  "A required OutputRepository (HEL-1337)" should {
    "make OutputControlsValidator reject null at construction" in {
      val ex = intercept[IllegalArgumentException] { new OutputControlsValidator(null, null) }
      ex.getMessage should include("OutputControlsValidator requires an OutputRepository")
    }

    "make WorkspaceContextService reject null at construction" in {
      val ex = intercept[IllegalArgumentException] { new WorkspaceContextService(null, null, null, null) }
      ex.getMessage should include("WorkspaceContextService requires an OutputRepository")
    }

    "make WorkspaceSearchService reject null at construction" in {
      val ex = intercept[IllegalArgumentException] { new WorkspaceSearchService(null, null, null, null, null) }
      ex.getMessage should include("WorkspaceSearchService requires an OutputRepository")
    }

    "make the patch-set apply context (via preview and apply) reject null at construction" in {
      val preview = intercept[IllegalArgumentException] {
        new PatchSetPreviewService(null, null, null, null, null, null, null)
      }
      preview.getMessage should include("PatchSetApplyContext requires an OutputRepository")
      val apply = intercept[IllegalArgumentException] {
        new PatchSetApplyService(null, null, null, null, null, null, null, null, null, null, null, null, null)
      }
      apply.getMessage should include("PatchSetApplyContext requires an OutputRepository")
    }

    "make the patch-set undo context reject null at construction" in {
      val ex = intercept[IllegalArgumentException] {
        new PatchSetUndoService(null, null, null, null, null, null, null, null, null, null, null)
      }
      ex.getMessage should include("PatchSetUndoContext requires an OutputRepository")
    }
  }
}
