package com.helio.services.pipelines.draftpreview

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicReference}

/** HEL-1630 design.md D5: the in-flight gate, in two stages so a slow uploader cannot hold a scarce slot.
 *
 *  A draft preview costs memory in two different ways. While its body is still arriving it holds at most the raw bytes (4 MiB), and
 *  how long that takes is up to the client; once decoded it holds the decoded frames and the walk's outcomes, which is what
 *  `maxInFlight` is sized for. So:
 *  - [[tryAcquire]] (before the body is read) takes a per-principal slot and a "reading" slot (`maxReading`, a multiple of
 *    `maxInFlight`); a client trickling its body occupies only those.
 *  - [[Permit.startRunning]] (after the bounded read, before decoding) takes one of the `maxInFlight` running slots.
 *
 *  A principal's two slots cover a superseded request that has not yet noticed its abort plus the next one. */
final class DraftPreviewGate(maxInFlight: Int, maxPerPrincipal: Int, maxReading: Int) {
  def this(maxInFlight: Int, maxPerPrincipal: Int) = this(maxInFlight, maxPerPrincipal, maxInFlight * 4)

  private val reading      = new AtomicInteger(0)
  private val running      = new AtomicInteger(0)
  private val perPrincipal = new ConcurrentHashMap[String, AtomicInteger]()

  private object Stage { val Reading = 0; val Running = 1; val Released = 2 }

  /** A held slot. [[release]] is idempotent: the route calls it on every pre-stream exit and the response stream calls it on
   *  termination, and whichever comes first wins. */
  final class Permit private[DraftPreviewGate] (principal: String) {
    private val stage   = new AtomicReference[Int](Stage.Reading)
    private val walking = new AtomicBoolean(false)

    /** The evaluation has begun: from here only [[release]] (called when the walk's Future completes) gives the slot back, never a
     *  stream ending, because a cancelled walk keeps evaluating its current node. */
    def walkStarted(): Unit = walking.set(true)

    /** For a stream that ended or expired: gives the slot back only when no walk was ever started on it. */
    def releaseUnlessWalking(): Unit = if (!walking.get()) release()

    /** Moves from the reading slot to a running slot; `false` (and the permit stays in the reading stage) when `maxInFlight` are
     *  already running. */
    def startRunning(): Boolean =
      if (running.incrementAndGet() > maxInFlight) { running.decrementAndGet(); false }
      else if (stage.compareAndSet(Stage.Reading, Stage.Running)) { reading.decrementAndGet(); true }
      else { running.decrementAndGet(); false }

    def release(): Unit = {
      val before = stage.getAndSet(Stage.Released)
      if (before != Stage.Released) {
        if (before == Stage.Reading) reading.decrementAndGet() else running.decrementAndGet()
        perPrincipal.computeIfPresent(principal, (_, n) => if (n.decrementAndGet() <= 0) null else n)
      }
    }
  }

  def tryAcquire(principal: String): Option[Permit] =
    if (reading.incrementAndGet() > maxReading) {
      reading.decrementAndGet()
      None
    } else {
      val mine = perPrincipal.compute(principal, (_, n) => { val c = if (n == null) new AtomicInteger(0) else n; c.incrementAndGet(); c })
      if (mine.get() > maxPerPrincipal) {
        reading.decrementAndGet()
        perPrincipal.computeIfPresent(principal, (_, n) => if (n.decrementAndGet() <= 0) null else n)
        None
      } else Some(new Permit(principal))
    }

  /** Requests running (past the read). */
  def inFlight: Int = running.get()

  /** Requests still reading their body. */
  def inReading: Int = reading.get()
}
