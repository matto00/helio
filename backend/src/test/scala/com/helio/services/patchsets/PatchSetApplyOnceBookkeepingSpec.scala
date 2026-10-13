package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{EditOutcome, PatchSetApplyResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.services.ServiceError
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, verify, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1522: a failure in the claim bookkeeping after the apply finished must not change the apply's own outcome. */
class PatchSetApplyOnceBookkeepingSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val user = AuthenticatedUser(UserId("00000000-0000-0000-0000-0000000000a1"))
  private val id   = "0b8b5c4e-3d0a-4f3b-9d77-2a8d3c1f6a10"
  private def outcome(status: String) = EditOutcome(0, status, None, None, None)

  private def repo(): PatchSetApplicationRepository = {
    val r = mock(classOf[PatchSetApplicationRepository])
    when(r.claimProposal(any(), any())).thenReturn(Future.successful(true))
    r
  }

  private def run(r: PatchSetApplicationRepository, result: Either[ServiceError, PatchSetApplyResponse]) =
    Await.result(PatchSetApplyOnce.run(r, Some(id), user)(Future.successful(result)), 5.seconds)

  "PatchSetApplyOnce" should {
    "return a successful apply even when attaching the application id fails" in {
      val r = repo()
      when(r.attachApplication(any(), any(), any())).thenReturn(Future.failed(new RuntimeException("db down")))
      val ok = Right(PatchSetApplyResponse(Vector(outcome("applied")), None, Some("app-1")))
      run(r, ok) shouldBe ok
      verify(r).attachApplication(user, id, "app-1")
    }

    "return a cleanly rolled-back apply even when releasing the claim fails" in {
      val r = repo()
      when(r.releaseProposal(any(), any())).thenReturn(Future.failed(new RuntimeException("db down")))
      val rolledBack = Right(PatchSetApplyResponse(Vector(outcome("rolledBack")), Some("boom"), None))
      run(r, rolledBack) shouldBe rolledBack
      verify(r).releaseProposal(user, id)
    }
  }
}
