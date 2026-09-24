package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeoutException
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-1168 (ticket "Must hold"; design.md D1-D4, D7, D9): proves cross-instance delivery over
 *  Postgres LISTEN/NOTIFY using TWO separate `PipelineRunRegistry` + `PipelineRunNotifyBus` pairs
 *  against the SAME embedded database -- simulating two Cloud Run instances sharing one Postgres,
 *  mirroring `V100ZeroRootGuardNonSuperuserSpec`'s EmbeddedPostgres-with-real-roles pattern. LISTEN/
 *  NOTIFY needs no application schema at all (design.md D3: no Flyway migration, no table), so this
 *  spec runs no migrations -- it connects directly as the EmbeddedPostgres superuser, which is a
 *  perfectly adequate stand-in for the plain non-privileged app role this feature actually uses in
 *  production (RLS/role privilege is irrelevant to LISTEN/NOTIFY itself). */
class PipelineRunCrossInstanceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def ec: ExecutionContext                        = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var jdbcUrl: String                    = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().start()
    db      = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")
  }

  override def afterAll(): Unit = {
    if (db != null) db.close()
    if (embeddedPostgres != null) embeddedPostgres.close()
    super.afterAll()
  }

  private def newBus(): PipelineRunNotifyBus =
    new PipelineRunNotifyBus(db, jdbcUrl, "postgres", "postgres")(ec)

  "cross-instance pipeline-run-event delivery (design.md D1-D4)" should {

    // Task 3.3's red half: with NO eventBus wired (today's per-instance-only shape), an event
    // published on one PipelineRunRegistry never reaches a subscriber on a DIFFERENT registry
    // instance, even though both are constructed in the same process here -- there is simply no
    // channel between them. This is a permanent characterization test of the unwired default,
    // not only a one-time demonstration: it also guards against ever silently degrading to
    // local-only broadcast when an eventBus is expected but absent (the exact failure mode
    // design.md's Migration Plan calls out as unacceptable).
    "an event published on instance A's registry does NOT reach instance B's registry when no eventBus is wired" in {
      val pid        = UUID.randomUUID().toString
      val registryA  = new PipelineRunRegistry()(typedSystem)
      val registryB  = new PipelineRunRegistry()(typedSystem)

      val eventsFuture = registryB.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))
      registryA.publish(pid, RunStatusEvent("succeeded"))

      a[TimeoutException] should be thrownBy Await.result(eventsFuture, 2.seconds)
    }

    // Task 3.3's green half, and the ticket's own headline AC.
    "an event published on instance A's registry reaches a subscriber connected to instance B's registry" in {
      val pid  = UUID.randomUUID().toString
      val busA = newBus()
      val busB = newBus()
      try {
        val registryA = new PipelineRunRegistry(eventBus = busA)(typedSystem)
        val registryB = new PipelineRunRegistry(eventBus = busB)(typedSystem)

        val eventsFuture = registryB.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))

        registryA.publish(pid, RunStatusEvent("succeeded", rowCount = Some(3)))

        val events = Await.result(eventsFuture, 10.seconds)
        events.map(_.status) shouldBe Seq("succeeded")
        events.head.rowCount shouldBe Some(3)
      } finally {
        busA.shutdown()
        busB.shutdown()
      }
    }

    // Ticket "Must hold": the NOTIFY channel must not become a cross-tenant/cross-pipeline side
    // channel. A subscriber for pipeline X on instance B must see nothing for a different
    // pipeline Y published on instance A.
    "does not leak across pipelines: a subscriber for pipeline X sees nothing published for pipeline Y" in {
      val pidX = UUID.randomUUID().toString
      val pidY = UUID.randomUUID().toString
      val busA = newBus()
      val busB = newBus()
      try {
        val registryA = new PipelineRunRegistry(eventBus = busA)(typedSystem)
        val registryB = new PipelineRunRegistry(eventBus = busB)(typedSystem)

        val eventsFuture = registryB.subscribe(pidX).take(1).runWith(Sink.seq)(Materializer(system))

        registryA.publish(pidY, RunStatusEvent("succeeded"))
        // The real event for pidX, so this test doesn't have to wait out a full timeout to pass.
        registryA.publish(pidX, RunStatusEvent("failed", errorLog = Some("only this one")))

        val events = Await.result(eventsFuture, 10.seconds)
        events.map(_.status)   shouldBe Seq("failed")
        events.head.errorLog shouldBe Some("only this one")
      } finally {
        busA.shutdown()
        busB.shutdown()
      }
    }

    // Design.md D7: the self-echo guard. Postgres delivers a NOTIFY back to the sending session's
    // OWN LISTEN connection too -- without the guard, instance A's own local subscriber would see
    // every event TWICE (once from the synchronous local broadcast, once from its own echoed
    // NOTIFY). Registry B is used purely as an independent, real-round-trip WITNESS: once it has
    // received the event, the NOTIFY has genuinely propagated through Postgres to every listening
    // session -- including instance A's own dedicated connection -- so checking A's capture buffer
    // at that point is not a race against the network, unlike asserting immediately after publish.
    "self-echo guard: instance A's own local subscriber receives its own published event exactly once" in {
      val pid  = UUID.randomUUID().toString
      val busA = newBus()
      val busB = newBus()
      try {
        val registryA = new PipelineRunRegistry(eventBus = busA)(typedSystem)
        val registryB = new PipelineRunRegistry(eventBus = busB)(typedSystem)

        val capturedA = scala.collection.mutable.Buffer[RunStatusEvent]()
        registryA.subscribe(pid).runForeach(capturedA += _)(Materializer(system))
        val witnessFuture = registryB.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))

        registryA.publish(pid, RunStatusEvent("queued"))

        Await.result(witnessFuture, 10.seconds)
        // Headroom past the witness's own receipt for A's dedicated LISTEN connection to have
        // received (and, if unguarded, re-delivered) its own echo -- Postgres broadcasts a NOTIFY
        // to every listening session at essentially the same time, so B's receipt is already
        // strong evidence the echo reached A too; this just avoids a hair-trigger race.
        Thread.sleep(500)

        capturedA.toList.map(_.status) shouldBe List("queued")
      } finally {
        busA.shutdown()
        busB.shutdown()
      }
    }
  }

  "NOTIFY payload size guard (design.md D9)" should {

    "keeps the encoded payload under Postgres's 8000-byte NOTIFY limit for an oversized ASCII errorLog" in {
      val busA = newBus()
      try {
        val hugeAscii = "x" * 20000
        val payload   = busA.encodePayload("pid-ascii", RunStatusEvent("failed", errorLog = Some(hugeAscii)))
        payload.getBytes(StandardCharsets.UTF_8).length should be < 8000
        payload should include("...[truncated]")
      } finally busA.shutdown()
    }

    // Skeptic-round-1 correction: the non-ASCII fixture is required to actually catch a
    // char-count-based (as opposed to byte-based) truncation bug -- see PipelineRunNotifyBusSpec
    // for the pure-logic version of this distinction. This test additionally proves Postgres
    // itself accepts the truncated payload for real: the 8000-byte limit is a hard server-side
    // constraint pg_notify enforces, not just this class's own budget arithmetic.
    "keeps the encoded payload under 8000 bytes for an oversized non-ASCII errorLog, and publishing does not throw" in {
      val busA = newBus()
      try {
        val hugeNonAscii = "漢字🎉" * 5000 // "漢字🎉" x5000 -- CJK + emoji, multi-byte throughout
        val event        = RunStatusEvent("failed", errorLog = Some(hugeNonAscii))
        val payload      = busA.encodePayload("pid-cjk", event)
        payload.getBytes(StandardCharsets.UTF_8).length should be < 8000
        payload should include("...[truncated]")

        noException should be thrownBy busA.notifyRemote("pid-cjk", event)
      } finally busA.shutdown()
    }
  }
}
