package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, PipelineRootId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.panels.LockRaceSupport
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.Future
import scala.util.Try

/** HEL-1498 W4-W8: a dashboard delete racing a pipeline / step / root / data-source / teardown delete whose FK
 *  cascade reaches two panels A < B (B inserted first). The panels sit on a GRANTEE's dashboard, bound to the
 *  pipeline OWNER's Output, so under RLS the owner cannot see them: only a lock that bypasses RLS (the migration's
 *  SECURITY DEFINER function) can order them. Each case is a RED proof pre-fix (40P01) and the regression guard
 *  after. See `LockRaceSupport.gateRace` for the interleave; the gate is the grantee deleting the dashboard. */
class PipelineCascadeLockOrderRaceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LockRaceSupport {

  private val pipelineOwner                 = newId()
  private val grantee                       = newId()
  private var appDb: JdbcBackend.Database   = _
  private var privDb: JdbcBackend.Database  = _
  private var pipelines: PipelineRepository = _
  private var steps: PipelineStepRepository = _
  private var roots: PipelineRootRepository = _
  private var sources: DataSourceRepository = _
  private var teardown: WorkspaceTeardownRepository = _
  private val user = AuthenticatedUser(UserId(pipelineOwner))

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try { seedUser(su, pipelineOwner); seedUser(su, grantee) } finally su.close()
    appDb     = racePool(None)
    privDb    = racePool(Some("SET ROLE helio_privileged"))
    val dbCtx = raceDbContext(appDb, privDb)
    sources   = new DataSourceRepository(dbCtx)
    pipelines = new PipelineRepository(dbCtx, sources)
    steps     = new PipelineStepRepository(dbCtx)
    roots     = new PipelineRootRepository(dbCtx)
    teardown  = new WorkspaceTeardownRepository(dbCtx)
  }

  override def afterAll(): Unit = {
    Try(appDb.close()); Try(privDb.close()); pg.close(); super.afterAll()
  }

  /** Panels A < B on a fresh grantee dashboard, both bound to `output`; returns (dashboard, A). */
  private def granteePanels(output: String): (String, String) = {
    val (a, b) = twoPanelIds()
    val d      = newId()
    val su     = superConn()
    try { seedDashboardWithPanels(grantee, d, Seq(b, a), Some(output)) } finally su.close()
    (d, a)
  }

  private def race(output: String)(writer: => Future[Any]): (Option[String], Option[String]) = {
    val (d, a) = granteePanels(output)
    val result = gateRace(grantee, a, d)(writer)()
    exists("dashboards", d) shouldBe false
    result
  }

  "a dashboard delete racing a cascading delete over two shared panels" should {
    "complete on both sides with no 40P01 (W4 PipelineRepository.delete)" in {
      val fx  = seedTwoRootPipeline(pipelineOwner)
      val out = seedOutput(pipelineOwner, fx.pipelineId, Some(fx.root1), None)
      race(out)(pipelines.delete(PipelineId(fx.pipelineId), user)) shouldBe ((None, None))
    }

    "complete on both sides with no 40P01 (W5 PipelineStepRepository.deleteInternal)" in {
      val fx   = seedTwoRootPipeline(pipelineOwner)
      val step = seedRootStep(fx.pipelineId, fx.root1)
      val out  = seedOutput(pipelineOwner, fx.pipelineId, None, Some(step))
      race(out)(steps.deleteInternal(PipelineStepId(step))) shouldBe ((None, None))
    }

    "complete on both sides with no 40P01 (W6 root removal)" in {
      val fx  = seedTwoRootPipeline(pipelineOwner)
      val out = seedOutput(pipelineOwner, fx.pipelineId, Some(fx.root1), None)
      val removal = steps.removeRootCascadeAction(PipelineId(fx.pipelineId), PipelineRootId(fx.root1))
        .flatMap(_ => roots.removeAction(PipelineRootId(fx.root1)))
      race(out)(pipelines.runTransactionally(pipelineOwner)(removal)) shouldBe ((None, None))
    }

    "complete on both sides with no 40P01 (W7 DataSourceRepository.delete)" in {
      // Two roots, so the V99/V100 zero-root guard lets the cascade through; root1 carries no steps.
      val fx  = seedTwoRootPipeline(pipelineOwner)
      val out = seedOutput(pipelineOwner, fx.pipelineId, Some(fx.root1), None)
      race(out)(sources.delete(DataSourceId(fx.source1), user)) shouldBe ((None, None))
    }

    "complete on both sides with no 40P01 (W8 WorkspaceTeardownRepository.teardown, untagged grantee dashboard)" in {
      val tag = s"t-${newId()}"
      val fx  = seedTwoRootPipeline(pipelineOwner, Some(tag))
      val out = seedOutput(pipelineOwner, fx.pipelineId, Some(fx.root1), None)
      race(out)(teardown.teardown(tag, dryRun = false, user)) shouldBe ((None, None))
    }
  }
}
