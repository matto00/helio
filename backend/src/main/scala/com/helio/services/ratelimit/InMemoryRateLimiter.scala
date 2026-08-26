package com.helio.services.ratelimit

import java.time.{Duration, Instant}
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** In-process, fixed-window (design.md D1) implementation of [[RateLimiter]]. Each key tracks a
 *  window-start `Instant` plus an [[AtomicInteger]] count; once the window has elapsed the
 *  counter is atomically replaced (not accumulated) via `ConcurrentHashMap.compute`, so entries
 *  never grow unbounded per key. No new library dependency -- a `ConcurrentHashMap` is sufficient
 *  for a fixed-window counter and keeps this foundational change dependency-free (design.md
 *  Planner Notes).
 *
 *  The window-expiry check, counter replacement, AND the increment all happen inside the single
 *  `compute` remapping function -- which `ConcurrentHashMap` guarantees runs atomically per key --
 *  so a concurrent caller can never observe or increment a counter that a simultaneous caller is
 *  in the process of replacing (a prior version incremented outside `compute` and had a benign
 *  lost-increment race under concurrent access to the same key).
 *
 *  Accepted limitation (design.md Risks): a caller can send up to `limit` requests just before a
 *  window resets and `limit` more just after, i.e. up to 2x `limit` in a short span straddling the
 *  boundary. This is documented, expected fixed-window behavior, not a defect. */
final class InMemoryRateLimiter extends RateLimiter {

  private final class WindowCounter(val windowStart: Instant, val count: AtomicInteger)

  private val buckets = new ConcurrentHashMap[String, WindowCounter]()

  override def tryAcquire(key: String, limit: Int, windowSeconds: Int): RateLimitResult = {
    val now = Instant.now()
    var observedCount = 0
    var observedWindowStart = now

    buckets.compute(
      key,
      (_, existing) => {
        val expired = existing == null || Duration.between(existing.windowStart, now).getSeconds >= windowSeconds
        val counter = if (expired) new WindowCounter(now, new AtomicInteger(0)) else existing
        observedCount = counter.count.incrementAndGet()
        observedWindowStart = counter.windowStart
        counter
      }
    )

    if (observedCount <= limit) {
      RateLimitResult.Allowed
    } else {
      val elapsedSeconds = Duration.between(observedWindowStart, now).getSeconds
      val retryAfterSeconds = math.max(1L, windowSeconds.toLong - elapsedSeconds)
      RateLimitResult.Exceeded(retryAfterSeconds)
    }
  }
}
