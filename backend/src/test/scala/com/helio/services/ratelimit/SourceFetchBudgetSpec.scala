package com.helio.services.ratelimit

import com.helio.domain.model.{ApiTokenId, AuditSource, AuthenticatedUser, UserId}
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1638 (C12): the budget draws from the bucket `RateLimitDirective` keys the same principal on, so a propose-time
 *  fetch and an HTTP preview/infer share one allowance: `user:<id>` for a session caller, `pat:<tokenId>` for a PAT caller. */
class SourceFetchBudgetSpec extends AnyWordSpec with Matchers {

  private val sessionUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-0000000000b1"))
  private val patUser     = sessionUser.copy(source = AuditSource.Ui, tokenId = Some(ApiTokenId("tok-1")))

  "SourceFetchBudget.charge" should {

    "draw a PAT caller from the pat:<tokenId> bucket the route directive uses" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("pat:tok-1", 1, 60) shouldBe RateLimitResult.Allowed // the directive spent the one allowance
      val budget = new SourceFetchBudget(limiter, 1, 60)
      budget.charge(patUser).left.toOption.exists(_.isInstanceOf[ServiceError.TooManyRequests]) shouldBe true
    }

    "draw a session caller from the user:<id> bucket" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire(s"user:${sessionUser.id.value}", 1, 60) shouldBe RateLimitResult.Allowed
      val budget = new SourceFetchBudget(limiter, 1, 60)
      budget.charge(sessionUser).isLeft shouldBe true
    }

    "keep a PAT caller's bucket separate from its owner's session bucket" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire(s"user:${sessionUser.id.value}", 1, 60)
      new SourceFetchBudget(limiter, 1, 60).charge(patUser) shouldBe Right(())
    }
  }
}
