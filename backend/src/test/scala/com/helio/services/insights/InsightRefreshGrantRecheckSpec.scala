package com.helio.services.insights

import com.helio.domain.insights._
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.testsupport._
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** HEL-1882 D4: a manual or pin insight refresh re-checks the requester's owner-or-editor access when the render STARTS, before
 *  any attempt row, quota charge or model call. The racer commits (superuser connection) right after the admission check
 *  returned, via a delegating `AccessChecker`: exactly "the grant changed between the route's check and the render".
 *
 *  Deterministic, no sleeps: every started render's result is awaited through the injected render observer. Red on main:
 *  the render reaches the model (`Wrote(_, reachedModel = true)`); green: a refused render (`Refused`), no send, no
 *  `output_insights` row, the pipeline owner's usage counter unchanged (the owner is on the counted `beta` tier). */
class InsightRefreshGrantRecheckSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with BeforeAndAfterEach with InsightRenderFixture {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  override protected def harnessEc: ExecutionContext = ec

  override def beforeAll(): Unit = { startHarness(); assertAppPoolEnforcesRls() }
  override def afterAll(): Unit  = stopHarness()
  override def beforeEach(): Unit = shiftedClock.offset = Duration.ZERO

  private val observed = new ConcurrentHashMap[String, Promise[InsightRenderService.RenderResult]]()
  private def watch(id: OutputId): Future[InsightRenderService.RenderResult] =
    observed.computeIfAbsent(id.value, _ => Promise[InsightRenderService.RenderResult]()).future
  private def result(id: OutputId): InsightRenderService.RenderResult = Await.result(watch(id), 15.seconds)

  /** `racer` runs once, right after the first admission check returns. */
  private final class RacingAccess(inner: AccessChecker, racer: () => Future[Any]) extends AccessChecker {
    @volatile private var armed = true
    override def requireOwnerOnly(rt: String, id: String, user: AuthenticatedUser, nf: String) = inner.requireOwnerOnly(rt, id, user, nf)
    override def requireAccess(rt: String, id: String, user: Option[AuthenticatedUser], nf: String) =
      inner.requireAccess(rt, id, user, nf).flatMap { r =>
        if (armed) { armed = false; racer().map(_ => r) } else Future.successful(r)
      }
  }

  private def service(model: FakeInsightModel, racer: () => Future[Any] = () => Future.successful(())): InsightRenderService =
    new InsightRenderService(
      outputRepo, pipelineRepo, stepRepo, snapshotRepo, historyService, insightRepo, gate(), new InsightRenderer(model), ClaudeModelCatalog.all,
      ClaudeModelCatalog.HaikuId, shiftedClock, ctx, new InsightAccess(outputRepo, new RacingAccess(accessChecker, racer)),
      InsightRenderConfig(timeout = 5.seconds), true, InsightLimits(),
      (id, r) => { observed.computeIfAbsent(id, _ => Promise[InsightRenderService.RenderResult]()).trySuccess(r); () }
    )

  private def editorOf(fx: Fx): (String, AuthenticatedUser) = {
    val editor = seedUser("beta")
    grantPipeline(fx.pid.value, editor, "editor")
    editor -> AuthenticatedUser(UserId(editor))
  }
  private def revoke(fx: Fx, editor: String): Future[Any] =
    db.run(sqlu"DELETE FROM resource_permissions WHERE resource_type='pipeline' AND resource_id=${fx.pid.value} AND grantee_id=$editor::uuid")
  private def downgrade(fx: Fx, editor: String): Future[Any] =
    db.run(sqlu"UPDATE resource_permissions SET role='viewer' WHERE resource_type='pipeline' AND resource_id=${fx.pid.value} AND grantee_id=$editor::uuid")

  private val racers: Vector[(String, (Fx, String) => Future[Any])] = Vector("revoked" -> revoke _, "downgraded to viewer" -> downgrade _)

  "a manual or pin refresh whose editor grant changes after admission" should {
    for ((kind, racer) <- racers; trigger <- Seq(InsightTrigger.Manual, InsightTrigger.Pin))
      s"refuse the render at its start: no send, no row, no charge (${trigger.wire}, $kind)" in {
        val fx            = seedFx()
        val (editor, usr) = editorOf(fx)
        val model         = new FakeInsightModel
        val svc           = service(model, () => racer(fx, editor))
        awaitDb(svc.refresh(fx.insight, usr, trigger)) shouldBe Right(InsightRefreshAccepted(fx.insight.value, started = true))
        val outcome = result(fx.insight)
        withClue(s"render outcome: $outcome; sends=${model.sends}")(outcome.toString shouldBe "Refused")
        model.sends shouldBe 0
        rowsOf(fx.insight) shouldBe empty
        counterOf(fx.owner) shouldBe 0
      }

    // GUARDS (green on main).
    "GUARD: a current editor's refresh still renders (one send, one ok row, the owner charged once)" in {
      val fx            = seedFx()
      val (editor, usr) = editorOf(fx)
      val model         = new FakeInsightModel
      val svc           = service(model)
      awaitDb(svc.refresh(fx.insight, usr, InsightTrigger.Manual)) shouldBe a[Right[_, _]]
      result(fx.insight).reachedModel shouldBe true
      model.sends shouldBe 1
      rowsOf(fx.insight).map(_.status) shouldBe Vector(InsightStatus.Ok)
      counterOf(fx.owner) shouldBe 1
      counterOf(editor) shouldBe 0
    }
    "GUARD: the pipeline owner's refresh still renders" in {
      val fx    = seedFx()
      val model = new FakeInsightModel
      val svc   = service(model)
      awaitDb(svc.refresh(fx.insight, asOwner(fx), InsightTrigger.Manual)) shouldBe a[Right[_, _]]
      result(fx.insight).reachedModel shouldBe true
      model.sends shouldBe 1
    }
    "GUARD: an automatic (run-triggered) render acts for no user and still renders" in {
      val fx    = seedFx()
      val model = new FakeInsightModel
      val svc   = service(model)
      val run   = awaitDb(svc.renderForRun(fx.pid, PipelineRunId("hel1882-run")))
      run shouldBe (())
      result(fx.insight).reachedModel shouldBe true
      model.sends shouldBe 1
    }
    "GUARD: a viewer's refresh is still refused 403 at admission (no render started)" in {
      val fx     = seedFx()
      val viewer = seedUser("beta")
      grantPipeline(fx.pid.value, viewer, "viewer")
      val model = new FakeInsightModel
      val svc   = service(model)
      awaitDb(svc.refresh(fx.insight, AuthenticatedUser(UserId(viewer)), InsightTrigger.Manual)) shouldBe Left(ServiceError.Forbidden("Only the pipeline owner or an editor can refresh an insight"))
      model.sends shouldBe 0
    }
  }
}
