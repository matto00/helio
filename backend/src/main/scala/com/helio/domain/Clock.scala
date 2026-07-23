package com.helio.domain

import java.time.Instant

/** Injectable wall-clock abstraction (HEL-415). `PipelineSchedulerService`
 *  takes a `Clock` rather than calling `Instant.now()` directly so tests can
 *  inject a deterministic fake clock instead of depending on real time or
 *  Pekko's real timer. */
trait Clock {
  def now(): Instant
}

/** Production default — delegates to the real wall clock. */
object SystemClock extends Clock {
  override def now(): Instant = Instant.now()
}
