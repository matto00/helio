package com.helio.services.pipelines

import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model._
import com.helio.domain.steps.AssertRule
import com.helio.infrastructure.persistence.pipelines.NodePayloadHistoryRepository
import com.helio.testsupport.NodePayloadFixtures
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Duration
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters._
import scala.util.Try

/** HEL-1276 write path (tasks 6.1-6.3): who gets a payload, the size caps, and atomicity with the
 *  node's snapshot replace. */
class NodePayloadHistoryWriteSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with NodePayloadFixtures {

  override protected def harnessEc: ExecutionContext = ExecutionContext.global
  private implicit val ec: ExecutionContext          = harnessEc

  private val user = (id: String) => AuthenticatedUser(UserId(id))

  override def beforeAll(): Unit = startHarness()
  override def afterAll(): Unit  = stopHarness()

  private def run(owner: String, fx: PayloadFx, dry: Boolean = false, cfg: PayloadHistoryConfig = PayloadHistoryConfig.Defaults) =
    awaitDb(runService(cfg).submit(fx.pid, isDry = dry, user(owner)))

  /** Warnings logged by the payload repository while `body` runs. */
  private def warnings[T](body: => T): (T, Vector[String]) = {
    val appender = new ListAppender[ILoggingEvent]()
    val logger   = LoggerFactory.getLogger(classOf[NodePayloadHistoryRepository]).asInstanceOf[LogbackLogger]
    appender.start(); logger.addAppender(appender)
    try {
      val r = body
      (r, appender.list.asScala.filter(_.getLevel == Level.WARN).map(_.getFormattedMessage).toVector)
    } finally logger.detachAppender(appender)
  }

  "a real successful run" should {

    "store a payload for an opted-in beta pipeline, linked ONLY to the opted-in Output's point" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner)
      run(owner, fx) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 1
      val link = payloadLinks(fx.optedOutput)
      link should have size 1
      link.head should not be empty
      payloadLinks(fx.plainOutput) shouldBe Vector(None)
      pointCount(fx.plainOutput) shouldBe 1
      val stored = awaitDb(payloadRepo.findById(UUID.fromString(link.head.get))).get
      stored.rowCount shouldBe 3
      stored.rows.elements.map(_.asJsObject.fields("label")) shouldBe Vector("a", "b", "c").map(JsString(_))
      stored.runId should not be empty
      stored.nodeStepId shouldBe Some(fx.stepId.value)
    }

    "store nothing when no Output on the node opted in (default off), but still write the summaries" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner, optedConfig = JsObject(OptedConfig.fields - "historyPayloads"))
      run(owner, fx) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 1
      payloadLinks(fx.optedOutput) shouldBe Vector(None)
    }

    "store nothing for an explicit historyPayloads=false" in {
      val owner = seedUser("owner")
      val fx    = seedPayloadPipeline(owner, optedConfig = JsObject(OptedConfig.fields + ("historyPayloads" -> JsBoolean(false))))
      run(owner, fx) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 0
    }

    "write NOTHING for a free-tier owner even when opted in, while still recording the summary point" in {
      val owner = seedUser("free")
      val fx    = seedPayloadPipeline(owner)
      run(owner, fx) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 1
      payloadLinks(fx.optedOutput) shouldBe Vector(None)
    }

    "write nothing for a dry run" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner)
      run(owner, fx, dry = true) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 0
    }

    "write nothing for a blocked run (error-severity assertion fails)" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner, rules = Vector(AssertRule("rowCountMin", None, JsObject("count" -> JsNumber(100)), "error")))
      run(owner, fx).toOption.get.blocked shouldBe true
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 0
    }
  }

  "the size caps" should {

    def cfg(rows: Int = 1000, bytes: Int = 1048576): PayloadHistoryConfig =
      PayloadHistoryConfig.Defaults.copy(maxRows = rows, maxBytes = bytes)

    "store no payload over the row cap, still write the summary and WARN" in {
      val owner = seedUser("owner")
      val fx    = seedPayloadPipeline(owner)
      val (_, warns) = warnings(run(owner, fx, cfg = cfg(rows = 2)))
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 1
      payloadLinks(fx.optedOutput) shouldBe Vector(None)
      warns.exists(_.contains("PAYLOAD_HISTORY_MAX_ROWS")) shouldBe true
    }

    "store exactly at the row cap" in {
      val owner = seedUser("owner")
      val fx    = seedPayloadPipeline(owner)
      run(owner, fx, cfg = cfg(rows = 3)) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 1
    }

    "measure compact-JSON UTF-8 BYTES, not characters: multi-byte rows store at exactly the byte cap and not one below" in {
      val owner = seedUser("owner")
      val rows  = Seq("é€é" -> "1", "ünï" -> "2")
      val probe = seedPayloadPipeline(owner, rows = rows)
      run(owner, probe) shouldBe a[Right[_, _]]
      val size = awaitDb(db.run(sql"SELECT byte_size FROM node_payload_history WHERE pipeline_id = ${probe.pid.value}".as[Int].head))
      val chars = awaitDb(payloadRepo.findById(UUID.fromString(payloadLinks(probe.optedOutput).head.get))).get.rows.compactPrint.length
      size should be > chars // multi-byte content: bytes exceed characters, so a String.length cap would be wrong

      val atCap = seedPayloadPipeline(owner, rows = rows)
      run(owner, atCap, cfg = cfg(bytes = size)) shouldBe a[Right[_, _]]
      payloadCount(atCap.pid.value) shouldBe 1

      val under = seedPayloadPipeline(owner, rows = rows)
      val (_, warns) = warnings(run(owner, under, cfg = cfg(bytes = size - 1)))
      payloadCount(under.pid.value) shouldBe 0
      pointCount(under.optedOutput) shouldBe 1
      warns.exists(_.contains("PAYLOAD_HISTORY_MAX_BYTES")) shouldBe true
      // A String.length cap at `size - 1` characters would have stored it: the discriminating case.
      (size - 1) should be >= chars
    }

    "log NO over-cap WARN for a free-tier opted-in node that is over both caps" in {
      val owner = seedUser("free")
      val fx    = seedPayloadPipeline(owner)
      val (_, warns) = warnings(run(owner, fx, cfg = cfg(rows = 1, bytes = 1)))
      warns.filter(m => m.contains("PAYLOAD_HISTORY") && m.contains(fx.pid.value)) shouldBe empty
      payloadCount(fx.pid.value) shouldBe 0
    }
  }

  "a failing payload insert" should {

    "roll back the node's snapshot replace and its summary insert, and store no payload" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner)
      val sentinel = Vector(JsObject("amount" -> JsString("999")))
      awaitDb(snapshotRepo.overwriteRows(fx.pid.value, Some(fx.stepId.value), sentinel, None))
      val failing = new NodePayloadHistoryRepository(ctx) {
        // Performs the real insert, THEN fails: only a shared transaction rolls the insert back.
        override def writeAction(
            pipelineId: String, nodeStepId: Option[String], rootId: Option[String], runId: Option[String], triggerSource: String,
            capturedAt: Instant, rows: Vector[JsObject], config: PayloadHistoryConfig
        ) = super.writeAction(pipelineId, nodeStepId, rootId, runId, triggerSource, capturedAt, rows, config)
          .flatMap(_ => DBIO.failed(new IllegalStateException("payload insert failed")))
      }
      val svc = new PipelineRunService(
        pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null,
        new LocalFileSystem(Paths.get("/")),
        outputRepo = outputRepo, nodeSnapshotRepo = snapshotRepo, outputHistoryRepo = historyRepo, nodePayloadRepo = failing
      )
      val outcome = Try(awaitDb(svc.submit(fx.pid, isDry = false, user(owner))))
      outcome.isFailure || outcome.get.isLeft shouldBe true
      awaitDb(snapshotRepo.listRows(fx.pid.value, Some(fx.stepId.value), explicitRootId = None)) shouldBe sentinel
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 0
      pointCount(fx.plainOutput) shouldBe 0
    }
  }

  "per-node trimming at write time" should {
    "delete exactly ONE excess payload per write, leaving a larger excess (a lowered cap) to the purge" in {
      val owner = seedUser("beta") // cap 10
      val fx    = seedPayloadPipeline(owner)
      (1 to 13).foreach(i => seedRawPayload(fx.pid.value, Some(fx.stepId.value), None, Instant.now().minusSeconds(3600L * i)))
      payloadCount(fx.pid.value) shouldBe 13
      run(owner, fx) shouldBe a[Right[_, _]]
      // 13 seeded + 1 written = 14; a one-row trim leaves 13 (a full trim to the cap would leave 10).
      payloadCount(fx.pid.value) shouldBe 13
    }

    "keep only the beta cap's 10 newest payloads on the 11th real run" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner)
      (1 to 11).foreach(_ => run(owner, fx) shouldBe a[Right[_, _]])
      payloadCount(fx.pid.value) shouldBe 10
      pointCount(fx.optedOutput) shouldBe 11
      payloadLinks(fx.optedOutput).count(_.isDefined) shouldBe 10 // the trimmed payload's point is un-linked, not deleted
    }
  }
}
