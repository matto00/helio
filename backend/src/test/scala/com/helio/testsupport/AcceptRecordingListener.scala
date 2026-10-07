package com.helio.testsupport

import java.net.{InetAddress, ServerSocket, Socket, SocketException}
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.jdk.CollectionConverters._

/** HEL-1341 (D3/D4): a loopback listener that records the REMOTE port of every connection it
 *  accepts, so a spec can prove "nothing connected" or "exactly one connection arrived" without
 *  a fixed sleep.
 *
 *  - Positive observation: [[awaitAccepted]] is a bounded state wait (ends the moment the count holds).
 *  - Negative observation: [[assertNothingAcceptedBeforeSentinel]] opens one sentinel connection and
 *    waits until the acceptor has taken it. A single acceptor drains the kernel backlog in arrival
 *    order, and any stray connection was established before its `connect()` returned, so it precedes
 *    the sentinel in the list; the accepted list must be exactly `[sentinelPort]`. Waiting on a bare
 *    count would exit on the stray, which is why the sentinel is identified by port. */
final class AcceptRecordingListener private () {

  private val server   = new ServerSocket(0, 50, InetAddress.getLoopbackAddress)
  private val accepted = new ConcurrentLinkedQueue[Int]()

  private val acceptor = new Thread(() =>
    try while (true) {
      val s = server.accept()
      accepted.add(s.getPort)
      s.close()
    } catch { case _: SocketException => () }
  )
  acceptor.setDaemon(true)
  acceptor.start()

  def port: Int = server.getLocalPort

  def acceptedPorts: List[Int] = accepted.asScala.toList

  /** Bounded state wait (give-up bound only, never a fixed sleep) until `n` connections were accepted. */
  def awaitAccepted(n: Int): Boolean =
    AcceptRecordingListener.awaitCondition(AcceptRecordingListener.AcceptStateWaitDeadline)(accepted.size >= n)

  /** The negative-observation barrier: true iff the accepted list is exactly the sentinel's port. */
  def assertNothingAcceptedBeforeSentinel(): (List[Int], Int) = {
    val sentinel = new Socket(InetAddress.getLoopbackAddress, port)
    try {
      val sentinelPort = sentinel.getLocalPort
      AcceptRecordingListener.awaitCondition(AcceptRecordingListener.AcceptStateWaitDeadline)(accepted.contains(sentinelPort))
      (acceptedPorts, sentinelPort)
    } finally sentinel.close()
  }

  def close(): Unit = server.close()
}

object AcceptRecordingListener {

  /** Give-up bound for the accept state waits (C6: a named deadline, never a fixed sleep). */
  val AcceptStateWaitDeadline: FiniteDuration = 5.seconds

  def start(): AcceptRecordingListener = new AcceptRecordingListener()

  private def awaitCondition(deadline: FiniteDuration)(cond: => Boolean): Boolean = {
    val end = System.nanoTime() + deadline.toNanos
    while (!cond && System.nanoTime() < end) Thread.onSpinWait()
    cond
  }
}
