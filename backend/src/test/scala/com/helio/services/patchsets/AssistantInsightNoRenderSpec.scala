package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{PatchSet, PatchSetProtocol}
import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, PipelineProposal, PipelineProposalSource}
import com.helio.domain.insights.{InsightModelFailure, InsightModelRequest, InsightModelResponse}
import com.helio.domain.model.{AuthenticatedUser, OutputId, OutputKind, PipelineId, UserId}
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.services.pipelines.{OutputService, PipelineProposalService, PipelineService}
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.testsupport.{FakeInsightModel, InsightRenderFixture, RecordingTrigger}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1779 D5: creating an insight Output writes no render, proven with the REAL `InsightRenderService` as the run
 *  path's `insightTrigger` over a fake model that records every call (and fails every one), never the default NoOp
 *  trigger (which would make "zero rows" true by construction).
 *
 *  - patch-set path: apply creates an `on_run` insight (the default refresh) on a pipeline that has already succeeded once,
 *    so the post-apply backfill really evaluates the node; no run is started, so no trigger call, no model call, no row.
 *  - pipeline-proposal path: apply RUNS the pipeline, and that run is an `on_run` insight's first render trigger (HEL-1743
 *    behaviour, unchanged). A `manual` insight gets nothing from it. This is a GUARD paired with an `on_run` control proving
 *    the wiring can see a render on this very path.
 *  - the final control in the patch-set test: a real run after the insight exists DOES call the trigger and the model. */
class AssistantInsightNoRenderSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with InsightRenderFixture with PatchSetProtocol {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  override protected def harnessEc: ExecutionContext = ec

  override def beforeAll(): Unit = { startHarness(); assertAppPoolEnforcesRls() }
  override def afterAll(): Unit  = stopHarness()

  private val failing: InsightModelRequest => Future[Either[InsightModelFailure, InsightModelResponse]] =
    _ => Future.failed(new IllegalStateException("model must not be called"))

  private final class Wiring {
    val model   = new FakeInsightModel
    model.behaviour = failing
    val service = newService(model)
    val trigger = new RecordingTrigger(service)
    val runs    = runsWith(trigger)
    private val backfills = new ConcurrentLinkedQueue[Future[Unit]]()
    val outputs = new OutputService(
      outputRepo, panelRepo, accessChecker, pipelineRunService = runs, nodeSnapshotRepo = snapshotRepo,
      backfillObserver = (_, f) => { backfills.add(f); () }
    )
    val applying = new PatchSetApplyService(
      null, null, null, null, panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker,
      new PatchSetApplicationRepository(ctx), outputRepo, outputs
    )
    /** Apply answers before `OutputService.backfillCreated`'s own `findById` has registered the backfill future, so first
     *  poll (bounded) until `expected` futures are registered, THEN await them: asserting after this means the backfill has
     *  really finished, not that it has not started. */
    def awaitBackfills(expected: Int): Int = {
      val deadline = System.nanoTime() + 30.seconds.toNanos
      while (backfills.size < expected && System.nanoTime() < deadline) Thread.sleep(20)
      withClue(s"backfills registered within 30 s")(backfills.size shouldBe expected)
      Await.result(Future.sequence(backfills.asScala.toVector), 30.seconds)
      backfills.size
    }
  }

  private def insightPatchSet(pipelineId: PipelineId, nodeStepId: String, config: String): PatchSet =
    s"""{"edits":[{"target":{"kind":"output","parentId":"${pipelineId.value}"},"op":"create",
        "patch":{"name":"Brief","kind":"insight","nodeStepId":"$nodeStepId","config":$config}}]}""".parseJson.convertTo[PatchSet]

  "a patch-set insight create" should {
    "write no render and make no model call, even for an on_run insight on a pipeline that already succeeded" in {
      val w  = new Wiring
      val fx = seedFx(withInsight = false)
      val user = asOwner(fx)
      realRun(w.runs, fx) shouldBe a[Right[_, _]]
      w.trigger.settle(1) // the only trigger call so far is the seeding run; no insight existed to render
      w.model.sends shouldBe 0

      val ps = insightPatchSet(fx.pid, fx.stepId.value, """{"preset":"auto"}""") // refresh defaults to on_run
      val response = Await.result(w.applying.apply(ps, user), 30.seconds).getOrElse(fail("apply refused"))
      response.failure shouldBe None
      val id = OutputId(response.edits.head.newId.getOrElse(fail("no id")))
      w.awaitBackfills(expected = 1) shouldBe 1 // registered, then completed: not merely still pending

      w.trigger.calls.get shouldBe 1
      w.model.sends shouldBe 0
      rowsOf(id) shouldBe empty
      awaitDb(outputRepo.findByIdInternal(id)).get.kind shouldBe OutputKind.Insight

      // Control: the same wiring DOES see a render when a real run follows.
      realRun(w.runs, fx) shouldBe a[Right[_, _]]
      w.trigger.settle(2)
      w.model.sends shouldBe 1
    }
  }

  private def proposal(config: String): PipelineProposal =
    PipelineProposal(
      pipelineName = s"hel1779-${UUID.randomUUID()}",
      roots = Vector(PipelineProposalSource(Some("DS"), None, None, None, None, None, None)),
      steps = Vector.empty,
      outputs = Vector(CreatePipelineTransactionalOutputRequest(None, "insight", "Brief", Some(config.parseJson.asJsObject)))
    )

  private def proposalService(w: Wiring): PipelineProposalService = {
    val pipelines = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)
    new PipelineProposalService(null, null, pipelines, w.runs, dataSourceRepo, outputRepo, SourceFetchBudget.default())
  }

  "a pipeline proposal with an insight Output" should {
    "GUARD: apply a manual insight; the apply run renders nothing (paired with the on_run control below)" in {
      val w  = new Wiring
      val fx = seedFx(withInsight = false)
      val p  = proposal("""{"refresh":"manual"}""").copy(roots = Vector(PipelineProposalSource(Some(fx.dsId), None, None, None, None, None, None)))
      val applied = Await.result(proposalService(w).apply(p, asOwner(fx)), 60.seconds).getOrElse(fail("apply refused"))
      val insightId = OutputId(applied.outputs.find(_.kind == "insight").getOrElse(fail("no insight output")).id)
      w.trigger.settle(1)
      w.model.sends shouldBe 0
      rowsOf(insightId) shouldBe empty
    }

    "CONTROL: an on_run insight IS rendered by the apply run (the wiring observes renders on this path)" in {
      val w  = new Wiring
      val fx = seedFx(withInsight = false)
      val p  = proposal("""{"refresh":"on_run"}""").copy(roots = Vector(PipelineProposalSource(Some(fx.dsId), None, None, None, None, None, None)))
      Await.result(proposalService(w).apply(p, asOwner(fx)), 60.seconds).getOrElse(fail("apply refused"))
      w.trigger.settle(1)
      w.model.sends shouldBe 1
    }

    "reject a non-empty reads.outputs with a 400 (a new pipeline has no stored Output to read)" in {
      val w  = new Wiring
      val fx = seedFx(withInsight = false)
      val p  = proposal("""{"refresh":"manual","reads":{"outputs":["some-id"]}}""").copy(roots = Vector(PipelineProposalSource(Some(fx.dsId), None, None, None, None, None, None)))
      Await.result(proposalService(w).apply(p, asOwner(fx)), 60.seconds) match {
        case Left(err) => err.message should include("reads.outputs")
        case Right(_)  => fail("expected a 400")
      }
    }
  }
}
