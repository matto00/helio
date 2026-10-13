package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model._
import com.helio.domain.panels.{OutputPanel, OutputPanelConfig}
import com.helio.infrastructure.persistence.panels.{LockRaceSupport, PanelRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.services.panels.{ItemSize, PlacementSizes}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import scala.concurrent.Future
import scala.util.Try

/** HEL-1534: a panel CREATE on dashboard D bound to Output O racing an Output-removing delete of O while O already has
 *  a panel on D. Create takes D `FOR UPDATE`, then its INSERT's FK check wants KEY SHARE on O (order D, then O). The
 *  cascading deletes (W4 pipeline, W5 step, W6 root removal, W7 data source, W8 teardown) locked panels, then O, then
 *  (V122's trigger, after the cascade) D: inverted. W3 deletes the panels explicitly before O, so D comes before O
 *  already (a GUARD, green before and after). The D is a GRANTEE's, invisible to the pipeline owner under RLS.
 *
 *  Interleave (driven by observed per-racer lock waits, never sleeps): a gate (schema owner, which SHARE mode needs)
 *  holds `LOCK TABLE panels IN SHARE MODE`. The create takes D and blocks on its panel INSERT; the delete's lock
 *  function (ROW SHARE) passes, and either (pre-fix) it deletes O and its cascade blocks on the gate, or (post-fix)
 *  it blocks on D. Then the gate commits. */
class OutputDeleteRacesPanelCreateSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LockRaceSupport {

  private val pipelineOwner                          = newId()
  private val grantee                                = newId()
  private var pools: Vector[JdbcBackend.Database]    = Vector.empty
  private var createRepo: PanelRepository            = _
  private var pipelines: PipelineRepository          = _
  private var steps: PipelineStepRepository          = _
  private var roots: PipelineRootRepository          = _
  private var sources: DataSourceRepository          = _
  private var teardown: WorkspaceTeardownRepository  = _
  private var outputs: OutputRepository              = _
  private val user                                   = AuthenticatedUser(UserId(pipelineOwner))
  private val sizes                                  = PlacementSizes(ItemSize(4, 5), ItemSize(4, 5), ItemSize(4, 5), ItemSize(4, 5))

  private def namedPool(name: String, init: Option[String]): JdbcBackend.Database = {
    val db = racePool(init, Some(name)); pools = pools :+ db; db
  }

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try { seedUser(su, pipelineOwner); seedUser(su, grantee) } finally su.close()
    createRepo = new PanelRepository(raceDbContext(namedPool("create-app", None), namedPool("create-priv", Some("SET ROLE helio_privileged"))))
    val del    = raceDbContext(namedPool("delete-app", None), namedPool("delete-priv", Some("SET ROLE helio_privileged")))
    sources    = new DataSourceRepository(del)
    pipelines  = new PipelineRepository(del, sources)
    steps      = new PipelineStepRepository(del)
    roots      = new PipelineRootRepository(del)
    teardown   = new WorkspaceTeardownRepository(del)
    outputs    = new OutputRepository(del)
  }

  override def afterAll(): Unit = {
    pools.foreach(p => Try(p.close())); pg.close(); super.afterAll()
  }

  private def outputPanel(id: String, dashboard: String, output: String): OutputPanel = {
    val now = Instant.now()
    OutputPanel(PanelId(id), DashboardId(dashboard), "o", ResourceMeta(grantee, now, now), PanelAppearance.Default, UserId(grantee),
      OutputPanelConfig(OutputId(output)))
  }

  private def count(sql: String): Int = {
    val su = superConn()
    try rows(su, sql)(_.getInt(1)).head finally su.close()
  }

  /** Dashboard D (grantee) holding one panel bound to `output`; the create adds a second. Returns (create, delete) SQLSTATEs. */
  private def race(output: String)(writer: => Future[Any]): (Option[String], Option[String]) = {
    val d = newId()
    seedDashboardWithPanels(grantee, d, Seq(newId()), Some(output))
    val gate = superConn()
    val result =
      try {
        gate.setAutoCommit(false)
        exec(gate, "LOCK TABLE panels IN SHARE MODE")
        val createSide = createRepo.insertPlaced(outputPanel(newId(), d, output), sizes)
        awaitLockWaitOf("create-", createSide)
        val deleteSide = writer
        awaitLockWaitOf("delete-", deleteSide)
        gate.commit()
        (sqlState(createSide), sqlState(deleteSide))
      } finally gate.close()
    info(s"states (create, delete) = $result")
    // Only meaningful when neither side was the deadlock victim (a victim rolls back, so O legitimately survives).
    if (result == ((None, None))) {
      exists("dashboards", d) shouldBe true
      exists("outputs", output) shouldBe false
      count(s"SELECT count(*) FROM panels WHERE output_id = '$output'") shouldBe 0
    }
    result
  }

  "a panel create racing an Output-removing delete" should {
    "complete on both sides with no 40P01 (W3 OutputRepository.deleteWithPanelsInternal, GUARD)" in {
      val fx  = seedTwoRootPipeline(pipelineOwner)
      val out = seedOutput(pipelineOwner, fx.pipelineId, Some(fx.root1), None)
      race(out)(outputs.deleteWithPanelsInternal(OutputId(out))) shouldBe ((None, None))
    }

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
