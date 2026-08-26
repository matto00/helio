package com.helio.services.ratelimit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Unit coverage for [[InMemoryRateLimiter]] (HEL-495 tasks.md 1.3): under-limit passes,
 *  over-limit rejects, window reset allows further requests, two different keys have independent
 *  counters, and window-boundary burst behaves as documented (accepted, not a defect). */
class InMemoryRateLimiterSpec extends AnyWordSpec with Matchers {

  "InMemoryRateLimiter.tryAcquire" should {

    "allow requests under the limit" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("k", limit = 3, windowSeconds = 60) shouldBe RateLimitResult.Allowed
      limiter.tryAcquire("k", limit = 3, windowSeconds = 60) shouldBe RateLimitResult.Allowed
      limiter.tryAcquire("k", limit = 3, windowSeconds = 60) shouldBe RateLimitResult.Allowed
    }

    "reject a request once the limit is exhausted, with a positive retryAfterSeconds" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("k", limit = 1, windowSeconds = 60)
      limiter.tryAcquire("k", limit = 1, windowSeconds = 60) match {
        case RateLimitResult.Exceeded(retryAfterSeconds) => retryAfterSeconds should be > 0L
        case other                                        => fail(s"expected Exceeded, got $other")
      }
    }

    "allow further requests after the window resets" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("k", limit = 1, windowSeconds = 0)
      // windowSeconds = 0: every call is treated as a new window (elapsed >= 0 immediately).
      limiter.tryAcquire("k", limit = 1, windowSeconds = 0) shouldBe RateLimitResult.Allowed
    }

    "track two different keys with independent counters" in {
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("a", limit = 1, windowSeconds = 60) shouldBe RateLimitResult.Allowed
      limiter.tryAcquire("a", limit = 1, windowSeconds = 60) shouldBe a[RateLimitResult.Exceeded]
      // "b" is unaffected by "a" being exhausted.
      limiter.tryAcquire("b", limit = 1, windowSeconds = 60) shouldBe RateLimitResult.Allowed
    }

    "accept more than `limit` total requests across repeated window-boundary resets (documented fixed-window limitation)" in {
      // Strengthened per final-gate skeptic round-1 non-blocking note 1: with limit = 1 and
      // windowSeconds = 0, every call lands in a freshly-reset window. If windowing were removed
      // entirely (limit enforced as one global counter, the failure mode this test must rule out),
      // the SECOND call here would be Exceeded, not Allowed -- unlike the original limit = 2/two-call
      // version, which passed identically whether or not windowing existed at all.
      val limiter = new InMemoryRateLimiter()
      limiter.tryAcquire("k", limit = 1, windowSeconds = 0) shouldBe RateLimitResult.Allowed
      limiter.tryAcquire("k", limit = 1, windowSeconds = 0) shouldBe RateLimitResult.Allowed
      limiter.tryAcquire("k", limit = 1, windowSeconds = 0) shouldBe RateLimitResult.Allowed
    }
  }
}
