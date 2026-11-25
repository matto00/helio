package com.helio.services.insights

import spray.json.JsonParser
import org.apache.pekko.stream.scaladsl.Sink
import org.apache.pekko.stream.Materializer
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.actor.typed.ActorSystem
import com.helio.services.pipelines.draftpreview.DraftPreviewService
import com.helio.services.ServiceError
import com.helio.domain.outputs.InsightConfig
import com.helio.api.routes.pipelines.PipelineRunRegistry
import com.helio.domain.insights._
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.testsupport._
import org.scalatest.BeforeAndAfterAll
import com.helio.domain.steps.{AssertConfig, LimitConfig, SortConfig, SortKey}
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import slick.jdbc.PostgresProfile.api._
import spray.json.JsObject
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.{Duration, Instant}
import java.util.concurrent.CopyOnWriteArrayList
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._

/** HEL-1743: the render service over a real database and the production run path, with a fake model transport.
 *  Tasks 4.1-4.8, 4.11, 4.14-4.17. */
class InsightRenderServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with org.scalatest.BeforeAndAfterEach with InsightRenderFixture {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  override protected def harnessEc: ExecutionContext = ec

  override def beforeAll(): Unit = { startHarness(); assertAppPoolEnforcesRls() }
  override def afterAll(): Unit  = stopHarness()
  override def beforeEach(): Unit = shiftedClock.offset = Duration.ZERO // render stamps must stay comparable to last_run_at

  private val hour = Duration.ofHours(1)

  /** A service and the trigger a real run calls; `model` is the fake the service sends through. */
  private def wired(model: FakeInsightModel = new FakeInsightModel, svcFactory: FakeInsightModel => InsightRenderService = null) = {
    val svc     = if (svcFactory == null) newService(model) else svcFactory(model)
    val trigger = new RecordingTrigger(svc)
    (svc, trigger, runsWith(trigger), model)
  }

  "a real run" should {

    "render an on_run insight once it has succeeded, recording the requested model, tokens and cost" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      realRun(runs, fx) shouldBe a[Right[_, _]]
      trigger.settle(1)
      model.sends shouldBe 1
      val row = rowsOf(fx.insight).head
      row.status shouldBe InsightStatus.Ok
      row.trigger shouldBe InsightTrigger.OnRun
      row.runId should not be empty
      row.model shouldBe Some(ClaudeModelCatalog.HaikuId)
      row.inputTokens shouldBe Some(120)
      row.costMicros should not be empty
    }

    // 4.1: the hook is outside the writes chain. The render hangs for a long time; the run, its returned future and its `succeeded`
    // event must all be complete WHILE the render is still in flight (a hook inside the chain would hold the run until it ends).
    "complete the run and publish succeeded while the render is still in flight (hook outside the writes chain)" in {
      val fx       = seedFx()
      val baseline = seedFx(withInsight = false)
      val typed: ActorSystem[Any] = ActorSystem(Behaviors.empty[Any], "insight-render-spec")
      try {
        val registry = new PipelineRunRegistry()(typed)
        val model    = new FakeInsightModel
        val (promise, hang) = hanging()
        model.behaviour = hang
        val svc  = newService(model, cfg = InsightRenderConfig(timeout = 60.seconds))
        val runs = runsWith(new RecordingTrigger(svc), registry)
        def events(f: Fx): Vector[String] = {
          val seen = registry.subscribe(f.pid.value).map(_.status).runWith(Sink.seq)(Materializer(typed))
          realRun(runs, f) shouldBe a[Right[_, _]]
          Await.result(seen, 10.seconds).toVector
        }
        val withHang = events(fx) // returns only if the run and its terminal event completed
        until("render in flight")(model.sends == 1)
        rowsOf(fx.insight) shouldBe empty // the render has not finished, yet the run already has
        val without = events(baseline)
        withHang shouldBe without
        withHang.last shouldBe "succeeded"
        promise.success(Right(InsightModelResponse("Late text.", FakeInsightModel.Usage, ClaudeModelCatalog.HaikuId)))
        until("render row")(rowsOf(fx.insight).size == 1)
      } finally typed.terminate()
    }

    "record a failed row, and write nothing late, when a never-answering model hits the render timeout" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      val (promise, hang) = hanging()
      model.behaviour = hang
      val svc  = newService(model, cfg = InsightRenderConfig(timeout = 600.millis))
      val runs = runsWith(new RecordingTrigger(svc))
      realRun(runs, fx) shouldBe a[Right[_, _]]
      until("timeout row")(rowsOf(fx.insight).nonEmpty)
      val row = rowsOf(fx.insight).head
      row.status shouldBe InsightStatus.Failed
      row.model shouldBe Some(ClaudeModelCatalog.HaikuId)
      promise.success(Right(InsightModelResponse("Late text.", FakeInsightModel.Usage, ClaudeModelCatalog.HaikuId)))
      Thread.sleep(400)
      rowsOf(fx.insight) should have size 1
    }

    "stay succeeded and record a failed attempt when the model throws" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      model.behaviour = _ => throw new IllegalStateException("boom")
      realRun(runs, fx) shouldBe a[Right[_, _]]
      trigger.settle(1)
      val row = rowsOf(fx.insight).head
      row.status shouldBe InsightStatus.Failed
      row.model shouldBe Some(ClaudeModelCatalog.HaikuId)
    }

    // HEL-1743 cycle 2 (known issue 3): a failure after a call still spent tokens, so its row records them and the cost.
    "record the usage and cost of a failed render that reached the model" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      model.behaviour = _ => Future.successful(Left(InsightModelFailure.NoAnswer("max_tokens", InsightUsage(4, 400, 1136, 0), Some(ClaudeModelCatalog.HaikuId))))
      realRun(runs, fx); trigger.settle(1)
      val row = rowsOf(fx.insight).head
      row.status shouldBe InsightStatus.Failed
      row.model shouldBe Some(ClaudeModelCatalog.HaikuId)
      (row.inputTokens, row.outputTokens, row.cacheCreationTokens) shouldBe ((Some(4), Some(400), Some(1136)))
      row.costMicros shouldBe InsightPriceTable.Default.costMicros(ClaudeModelCatalog.HaikuId, InsightUsage(4, 400, 1136, 0))
      row.costMicros should not be empty
    }

    // 4.2
    "never render for a dry run" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      awaitDb(runs.submit(fx.pid, isDry = true, asOwner(fx))) shouldBe a[Right[_, _]]
      Thread.sleep(300)
      trigger.calls.get shouldBe 0
      model.sends shouldBe 0
      rowsOf(fx.insight) shouldBe empty
    }

    "never render for a failed run" in {
      val fx = seedFx()
      breakPipeline(fx)
      val (_, trigger, runs, model) = wired()
      realRun(runs, fx) shouldBe a[Left[_, _]]
      Thread.sleep(300)
      trigger.calls.get shouldBe 0
      model.sends shouldBe 0
    }

    "not have a draft preview path to a render" in {
      val params = classOf[DraftPreviewService].getConstructors.flatMap(_.getParameterTypes)
      params.exists(c => classOf[InsightRunTrigger].isAssignableFrom(c) || c == classOf[InsightRenderService]) shouldBe false
    }
  }

  "the guards" should {

    // 4.3
    "make zero sends for a free-tier owner and keep ONE skipped_quota row however often data changes, by every trigger" in {
      val fx = seedFx(tier = "free")
      val (svc, trigger, runs, model) = wired()
      for (i <- 1 to 3) {
        setAmounts(fx, Seq(s"${i * 100}", s"${i * 100 + 1}"))
        realRun(runs, fx) shouldBe a[Right[_, _]]
        trigger.settle(i)
      }
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual)) shouldBe Right(InsightRefreshAccepted(fx.insight.value, started = true))
      until("manual row stamped")(rowsOf(fx.insight).exists(_.trigger == InsightTrigger.Manual))
      shiftedClock.advance(Duration.ofDays(2))
      val daily = seedFx(tier = "free", insightConfig = """{"refresh":"daily"}""")
      awaitDb(db.run(sqlu"DELETE FROM outputs WHERE kind = 'insight' AND id NOT IN (${fx.insight.value}, ${daily.insight.value})"))
      awaitDb(svc.tickPass(shiftedClock.now()))
      model.sends shouldBe 0
      val rows = rowsOf(fx.insight)
      rows should have size 1
      rows.head.status shouldBe InsightStatus.SkippedQuota
      rows.head.model shouldBe None
      counterOf(fx.owner) shouldBe 0
      rowsOf(daily.insight).foreach(_.status shouldBe InsightStatus.SkippedQuota)
    }

    // 4.4
    "make one send for ten identical real runs, leaving one ok and one coalesced skipped_unchanged row" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      var tenthStart = Instant.EPOCH
      for (i <- 1 to 10) {
        shiftedClock.advance(Duration.ofHours(2))
        tenthStart = shiftedClock.now()
        realRun(runs, fx) shouldBe a[Right[_, _]]
        trigger.settle(i)
      }
      model.sends shouldBe 1
      val rows = rowsOf(fx.insight)
      rows.map(_.status) shouldBe Vector(InsightStatus.Ok, InsightStatus.SkippedUnchanged)
      rows.last.inputTokens shouldBe None
      rows.last.createdAt.toEpochMilli should be >= tenthStart.toEpochMilli
    }

    // 4.5
    "throttle a changed-data render within the hour with no row, then catch it up from the tick pass" in {
      val fx = seedFx()
      val (svc, trigger, runs, model) = wired()
      realRun(runs, fx); trigger.settle(1)
      setAmounts(fx, Seq("500", "600"))
      realRun(runs, fx); trigger.settle(2)
      model.sends shouldBe 1
      rowsOf(fx.insight) should have size 1
      shiftedClock.advance(Duration.ofMinutes(61))
      isolate(fx)
      awaitDb(svc.tickPass(shiftedClock.now()))
      model.sends shouldBe 2
      model.requests(1).user should include("600")
      rowsOf(fx.insight).map(_.status) shouldBe Vector(InsightStatus.Ok, InsightStatus.Ok)
    }

    "call a failing model at most once an hour, recording the requested model on the failed row" in {
      val fx = seedFx()
      val (_, trigger, runs, model) = wired()
      model.behaviour = _ => Future.successful(Left(InsightModelFailure.Transport("down")))
      realRun(runs, fx); trigger.settle(1)
      setAmounts(fx, Seq("7", "8"))
      realRun(runs, fx); trigger.settle(2)
      model.sends shouldBe 1
      val rows = rowsOf(fx.insight)
      rows should have size 1
      rows.head.status shouldBe InsightStatus.Failed
      rows.head.model shouldBe Some(ClaudeModelCatalog.HaikuId)
    }

    "let a manual refresh bypass the throttle but not the digest skip" in {
      val fx = seedFx()
      val (svc, trigger, runs, model) = wired()
      realRun(runs, fx); trigger.settle(1)
      setAmounts(fx, Seq("31", "32"))
      realRun(runs, fx); trigger.settle(2) // throttled: no send, no row
      model.sends shouldBe 1
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("second send")(model.sends == 2)
      until("manual ok row")(rowsOf(fx.insight).size == 2)
      rowsOf(fx.insight).last.trigger shouldBe InsightTrigger.Manual
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("unchanged row")(rowsOf(fx.insight).size == 3)
      model.sends shouldBe 2
      rowsOf(fx.insight).last.status shouldBe InsightStatus.SkippedUnchanged
    }

    // 4.16 / ER1: overlapping runs, the round-6 counterexample. Run 2's write phase BEGINS (its `last_run_at` value is taken) before
    // render 1 starts, and COMMITS after render 1 has read its inputs, so last_run_at(run 2) < render 1's start.
    "catch up a run whose write phase began before an earlier render started and committed after it read (ER1, overlapping)" in {
      val fx    = seedFx()
      val model = new FakeInsightModel
      val svc   = newService(model)
      // Run 1's render is held back until run 2 has begun its write phase.
      val releaseRender1 = Promise[Unit]()
      val delayed = new InsightRunTrigger {
        override def afterRunSucceeded(p: PipelineId, r: PipelineRunId): Future[Unit] = releaseRender1.future.flatMap(_ => svc.afterRunSucceeded(p, r))
      }
      val trigger1 = new RecordingTrigger(delayed)
      setAmounts(fx, Seq("10", "20"))
      realRun(runsWith(trigger1), fx) shouldBe a[Right[_, _]]
      // Run 2 stops at its snapshot commit (after `last_run_at`'s instant was taken at the start of its write phase).
      val reached    = Promise[Unit]()
      val commitGate = Promise[Unit]()
      val gated = new NodeSnapshotRepository(ctx)(harnessEc) {
        override def overwriteRowsWith(
            pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String],
            andThen: DBIO[Unit], guard: Option[DBIO[Unit]]
        ): Future[Unit] = { reached.trySuccess(()); commitGate.future.flatMap(_ => super.overwriteRowsWith(pipelineId, nodeStepId, rows, explicitRootId, andThen, guard)) }
      }
      val trigger2 = new RecordingTrigger(svc)
      setAmounts(fx, Seq("111", "222"))
      val run2 = runsWith(trigger2, snapshots = gated).submit(fx.pid, isDry = false, asOwner(fx))
      Await.result(reached.future, 15.seconds)
      Thread.sleep(50)
      releaseRender1.success(()) // render 1 starts NOW, after run 2's write phase began, and reads run 1's committed data
      trigger1.settle(1)
      model.sends shouldBe 1
      model.requests.head.user should not include "222"
      commitGate.success(()) // run 2 commits after render 1 read its inputs
      awaitDb(run2) shouldBe a[Right[_, _]]
      trigger2.settle(1) // render 2 is throttled (a model call within the hour): no send, no row
      model.sends shouldBe 1
      rowsOf(fx.insight) should have size 1
      shiftedClock.advance(Duration.ofHours(2))
      isolate(fx)
      awaitDb(svc.tickPass(shiftedClock.now()))
      model.sends shouldBe 2
      model.requests(1).user should include("222")
      shiftedClock.advance(Duration.ofMinutes(20)) // next aligned bucket: nothing is due any more
      awaitDb(svc.tickPass(shiftedClock.now()))
      model.sends shouldBe 2
    }

    // 4.16 / ER1: a success followed by a failed run.
    "catch up a throttled success even though a failed run came after it (ER1, success then failed)" in {
      val fx = seedFx()
      val (svc, trigger, runs, model) = wired()
      realRun(runs, fx); trigger.settle(1)
      setAmounts(fx, Seq("901", "902"))
      realRun(runs, fx); trigger.settle(2)
      model.sends shouldBe 1
      breakPipeline(fx)
      realRun(runs, fx) shouldBe a[Left[_, _]]
      shiftedClock.advance(Duration.ofHours(2))
      isolate(fx)
      awaitDb(svc.tickPass(shiftedClock.now()))
      model.sends shouldBe 2
      model.requests(1).user should include("902")
    }
  }

  "weighted, owner-charged quota" should {

    // 4.6
    for ((id, weight) <- Seq(ClaudeModelCatalog.HaikuId -> 1, ClaudeModelCatalog.SonnetId -> 4, ClaudeModelCatalog.OpusId -> 8))
      s"charge a beta owner $weight for $id, once, and request that model" in {
        val fx = seedFx(insightConfig = s"""{"model":"$id"}""")
        val (svc, _, _, model) = wired()
        awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
        until("ok row")(rowsOf(fx.insight).nonEmpty)
        counterOf(fx.owner) shouldBe weight
        model.requests.head.model shouldBe Some(id)
        rowsOf(fx.insight).head.model shouldBe Some(id)
      }

    "honour an env weight override, charge the validator retry only once, and never count an owner-tier owner" in {
      val catalog = ClaudeModelCatalog.fromEnv(Map("HELIO_BETA_MODEL_WEIGHTS" -> "claude-sonnet-5-5=6"))
      val fx      = seedFx(insightConfig = """{"model":"claude-sonnet-5-5"}""")
      val m1      = new FakeInsightModel
      var n       = 0
      m1.behaviour = r => { n += 1; Future.successful(Right(InsightModelResponse(if (n == 1) "Revenue is 999." else "Revenue held steady.", FakeInsightModel.Usage, r.model.get))) }
      val svc = newService(m1, catalog = catalog)
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("ok row")(rowsOf(fx.insight).nonEmpty)
      m1.sends shouldBe 2
      counterOf(fx.owner) shouldBe 6
      val ownerFx = seedFx(tier = "owner", insightConfig = """{"model":"claude-opus-5-5"}""")
      awaitDb(svc.refresh(ownerFx.insight, asOwner(ownerFx), InsightTrigger.Manual))
      until("owner row")(rowsOf(ownerFx.insight).nonEmpty)
      counterOf(ownerFx.owner) shouldBe 0
    }

    "charge the pipeline owner, never the editor who triggered it" in {
      val fx     = seedFx()
      val editor = seedUser("beta")
      grantPipeline(fx.pid.value, editor, "editor")
      val (svc, _, _, _) = wired()
      awaitDb(svc.refresh(fx.insight, AuthenticatedUser(UserId(editor)), InsightTrigger.Manual)) shouldBe a[Right[_, _]]
      until("ok row")(rowsOf(fx.insight).nonEmpty)
      counterOf(fx.owner) shouldBe 1
      counterOf(editor) shouldBe 0
    }
  }

  "model resolution" should {

    // 4.7
    "use the server default, with weight 1, when it is not a catalog model and the insight has no model" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      val svc = newService(model, serverDefault = "claude-opus-4-8")
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("ok row")(rowsOf(fx.insight).nonEmpty)
      model.requests.head.model shouldBe None
      counterOf(fx.owner) shouldBe 1
      rowsOf(fx.insight).head.model shouldBe Some("claude-opus-4-8")
    }

    "record a failed, no-model row and charge nothing for a stored model that is no longer selectable" in {
      val fx = seedFx(insightConfig = """{"model":"claude-opus-5-5"}""")
      val narrowed = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-haiku-5-5"))
      val model = new FakeInsightModel
      val svc = newService(model, catalog = narrowed)
      for (_ <- 1 to 2) {
        awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
        Thread.sleep(300)
      }
      model.sends shouldBe 0
      counterOf(fx.owner) shouldBe 0
      val rows = rowsOf(fx.insight)
      rows should have size 1
      rows.head.status shouldBe InsightStatus.Failed
      rows.head.model shouldBe None
    }

    "record a no-model failed row and charge nobody when no model is configured" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      val svc = newService(model, available = false)
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("failed row")(rowsOf(fx.insight).nonEmpty)
      model.sends shouldBe 0
      counterOf(fx.owner) shouldBe 0
      rowsOf(fx.insight).head.model shouldBe None
    }
  }

  "coalescing" should {

    "never move a row's stamp backwards (an overlapping render that started earlier)" in {
      val fx = seedFx()
      val t  = Instant.parse("2031-05-05T10:00:00Z")
      val id = awaitDb(insightRepo.insertReturningId(OutputInsightInsert(fx.insight.value, fx.pid.value, None, InsightTrigger.OnRun, InsightStatus.SkippedQuota, None, createdAt = t.plusSeconds(600))))
      awaitDb(insightRepo.coalesce(id, t, InsightTrigger.Manual, None, None))
      rowsOf(fx.insight).head.createdAt shouldBe t.plusSeconds(600)
      awaitDb(insightRepo.coalesce(id, t.plusSeconds(1200), InsightTrigger.Daily, None, None))
      rowsOf(fx.insight).head.createdAt shouldBe t.plusSeconds(1200)
      rowsOf(fx.insight).head.trigger shouldBe InsightTrigger.Daily
    }
  }

  "coalescing (ER2)" should {

    // 4.15 / 4.17
    "merge a no-model failed row only into a newest row that is also a no-model failed" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      val keyless = newService(model, available = false)
      awaitDb(keyless.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("first")(rowsOf(fx.insight).nonEmpty)
      awaitDb(keyless.refresh(fx.insight, asOwner(fx), InsightTrigger.Pin))
      until("coalesced")(rowsOf(fx.insight).headOption.exists(_.trigger == InsightTrigger.Pin))
      rowsOf(fx.insight) should have size 1
    }

    "never alter a failed row that carries a model, tokens or cost, and insert a new row instead" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      model.behaviour = _ => Future.successful(Left(InsightModelFailure.Transport("down")))
      val working = newService(model)
      awaitDb(working.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("modelled failed")(rowsOf(fx.insight).nonEmpty)
      val before = rowsOf(fx.insight).head
      val keyless = newService(new FakeInsightModel, available = false)
      awaitDb(keyless.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("second row")(rowsOf(fx.insight).size == 2)
      val rows = rowsOf(fx.insight)
      rows.head shouldBe before
      rows.last.model shouldBe None
    }
  }

  "the tick pass" should {

    // 4.8
    "render a daily insight once, at the 06:00 UTC bucket, and never again that day" in {
      val fx = seedFx(insightConfig = """{"refresh":"daily"}""")
      val (svc, _, _, model) = wired()
      isolate(fx)
      val day = Instant.parse("2031-03-04T00:00:00Z")
      awaitDb(svc.tickPass(day.plusSeconds(5 * 3600 + 59 * 60)))
      model.sends shouldBe 0
      awaitDb(svc.tickPass(day.plusSeconds(6 * 3600)))
      model.sends shouldBe 1
      rowsOf(fx.insight).head.trigger shouldBe InsightTrigger.Daily
      awaitDb(svc.tickPass(day.plusSeconds(6 * 3600 + 10 * 60)))
      awaitDb(svc.tickPass(day.plusSeconds(6 * 3600 + 30 * 60)))
      model.sends shouldBe 1
    }

    "render once when two service instances run the pass concurrently" in {
      val fx = seedFx(insightConfig = """{"refresh":"daily"}""")
      val model = new FakeInsightModel
      val (gatePromise, hang) = hanging()
      model.behaviour = hang
      isolate(fx)
      val a = newService(model); val b = newService(model)
      val now = Instant.parse("2031-03-05T06:00:00Z")
      val fa = a.tickPass(now)
      until("first instance sending")(model.sends == 1)
      awaitDb(b.tickPass(now))
      model.sends shouldBe 1
      gatePromise.success(Right(InsightModelResponse("Once.", FakeInsightModel.Usage, ClaudeModelCatalog.HaikuId)))
      awaitDb(fa)
      model.sends shouldBe 1
      rowsOf(fx.insight) should have size 1
    }

    "skip the bucket when another session holds the lock" in {
      val fx = seedFx(insightConfig = """{"refresh":"daily"}""")
      val (svc, _, _, model) = wired()
      isolate(fx)
      val conn = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        conn.createStatement().execute(s"SELECT pg_advisory_lock(${InsightRenderService.LockKey})")
        awaitDb(svc.tickPass(Instant.parse("2031-03-06T06:00:00Z")))
        model.sends shouldBe 0
      } finally conn.close()
      rowsOf(fx.insight) shouldBe empty
    }
  }

  "InsightRendered and latestFor" should {

    // 4.11
    "publish one event for the ok render only, and latestFor returns the newest ok" in {
      val fx = seedFx()
      val model = new FakeInsightModel
      val svc = newService(model)
      val seen = new CopyOnWriteArrayList[InsightRendered]()
      svc.addListener(e => seen.add(e))
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual))
      until("ok row")(rowsOf(fx.insight).nonEmpty)
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual)) // unchanged: skipped, no event
      until("skip row")(rowsOf(fx.insight).size == 2)
      seen.asScala.toVector.map(_.outputId) shouldBe Vector(fx.insight.value)
      val ok = rowsOf(fx.insight).head
      seen.get(0).recordId shouldBe ok.id
      awaitDb(svc.latestFor(fx.insight.value)).map(_.id) shouldBe Some(ok.id)
    }
  }

  "manual refresh" should {

    "refuse a viewer, hide a stranger, and report started=false while a render is in flight" in {
      val fx = seedFx()
      val viewer = seedUser("beta"); val stranger = seedUser("beta")
      grantPipeline(fx.pid.value, viewer, "viewer")
      val model = new FakeInsightModel
      val (p, hang) = hanging()
      model.behaviour = hang
      val svc = newService(model)
      awaitDb(svc.refresh(fx.insight, AuthenticatedUser(UserId(viewer)), InsightTrigger.Manual)) shouldBe a[Left[_, _]]
      awaitDb(svc.refresh(fx.insight, AuthenticatedUser(UserId(viewer)), InsightTrigger.Manual)).left.toOption.get shouldBe a[ServiceError.Forbidden]
      awaitDb(svc.refresh(fx.insight, AuthenticatedUser(UserId(stranger)), InsightTrigger.Manual)).left.toOption.get shouldBe a[ServiceError.NotFound]
      awaitDb(svc.refresh(fx.metric, asOwner(fx), InsightTrigger.Manual)).left.toOption.get shouldBe a[ServiceError.NotFound]
      model.sends shouldBe 0
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Pin)) shouldBe Right(InsightRefreshAccepted(fx.insight.value, started = true))
      until("in flight")(model.sends == 1)
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual)) shouldBe Right(InsightRefreshAccepted(fx.insight.value, started = false))
      p.success(Right(InsightModelResponse("Done.", FakeInsightModel.Usage, ClaudeModelCatalog.HaikuId)))
      until("pin row")(rowsOf(fx.insight).nonEmpty)
      rowsOf(fx.insight).head.trigger shouldBe InsightTrigger.Pin
    }
  }

  "the inputs a render reads" should {

    // 4.14
    def builder = new InsightInputsBuilder(outputRepo, stepRepo, snapshotRepo, historyService)
    def inputsFor(fx: Fx, cfgJson: String) = {
      val insight  = awaitDb(outputRepo.findByIdInternal(fx.insight)).get
      val pipeline = awaitDb(pipelineRepo.findByIdInternal(fx.pid)).get
      val cfg      = InsightConfig.parse(JsonParser(cfgJson).asJsObject, _ => true).toOption.get
      awaitDb(builder.build(insight, cfg, pipeline, Instant.now(), InsightLimits()))
    }

    "infer delta from a metric-with-compare sibling, and read the node's siblings when reads.outputs is absent" in {
      val fx = seedFx()
      val (_, trigger, runs, _) = wired()
      realRun(runs, fx); realRun(runs, fx)
      val built = inputsFor(fx, "{}")
      built.preset shouldBe InsightPreset.Delta
      built.inputs.compares.map(_.outputId) shouldBe Vector(fx.metric.value)
      built.inputs.head should not be empty
    }

    "skip a dangling id and the insight itself in reads.outputs" in {
      val fx = seedFx()
      realRun(runsWith(InsightRunTrigger.NoOp), fx)
      val built = inputsFor(fx, s"""{"reads":{"outputs":["gone","${fx.insight.value}"]}}""")
      built.inputs.compares shouldBe empty
    }

    "read an Output on another node when reads.outputs names it, yet leave the preset to the insight's own node" in {
      val fx = seedFx(withInsight = false) // the metric-with-compare Output lives on the first step
      val noop = runsWith(InsightRunTrigger.NoOp)
      realRun(noop, fx); realRun(noop, fx) // two history points, so the metric has a previous_run compare
      val child = awaitDb(stepRepo.insertInternal(fx.pid, "assert", AssertConfig(Vector.empty), enabled = true, Some(fx.stepId), explicitRootId = None))
      val insight = awaitDb(outputRepo.insertInternal(fx.pid, Some(child.id), UserId(fx.owner), "far insight", OutputKind.Insight, JsObject.empty, explicitRootId = None, actor = AuthenticatedUser(UserId(fx.owner))))
      val built = inputsFor(fx.copy(insight = insight.id), s"""{"reads":{"outputs":["${fx.metric.value}"]}}""")
      built.inputs.compares.map(_.outputId) shouldBe Vector(fx.metric.value) // read from another node...
      built.preset shouldBe InsightPreset.Summary                            // ...but its compare is not on the insight's node
    }

    "ignore a disabled step's op when inferring the preset" in {
      def preset(limitEnabled: Boolean): InsightPreset = {
        val fx   = seedFx(withInsight = false)
        val sort = awaitDb(stepRepo.insertInternal(fx.pid, "sort", SortConfig(Vector(SortKey("amount", "desc"))), enabled = true, Some(fx.stepId), explicitRootId = None))
        val lim  = awaitDb(stepRepo.insertInternal(fx.pid, "limit", LimitConfig(1), enabled = limitEnabled, Some(sort.id), explicitRootId = None))
        awaitDb(outputRepo.insertInternal(fx.pid, Some(lim.id), UserId(fx.owner), "top", OutputKind.Table, JsObject.empty, explicitRootId = None, actor = AuthenticatedUser(UserId(fx.owner))))
        val insight = awaitDb(outputRepo.insertInternal(fx.pid, Some(lim.id), UserId(fx.owner), "top insight", OutputKind.Insight, JsObject.empty, explicitRootId = None, actor = AuthenticatedUser(UserId(fx.owner))))
        inputsFor(fx.copy(insight = insight.id), "{}").preset
      }
      preset(limitEnabled = true) shouldBe InsightPreset.Leaders  // sort then limit under a table: the TopN shape
      preset(limitEnabled = false) shouldBe InsightPreset.Summary // the disabled limit no longer counts
    }
  }
}
