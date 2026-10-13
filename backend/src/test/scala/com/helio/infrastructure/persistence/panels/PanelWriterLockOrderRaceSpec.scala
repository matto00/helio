package com.helio.infrastructure.persistence.panels

import com.helio.api.protocols.panels.PanelBatchItem
import com.helio.domain.model.{AuthenticatedUser, DashboardId, DashboardLayout, OutputId, UserId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.pipelines.OutputService
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import scala.util.Try

/** HEL-1498 W1-W3: a dashboard delete racing a panel writer over TWO shared panels A < B (B inserted first, so
 *  scan order is B, A). RED/GUARD legend (see `LockRaceSupport.gateRace` for the interleave): every case here is a
 *  RED proof on the pre-fix code (40P01 on one side) and the same assertion is the post-fix regression guard.
 *
 *  W1 `DashboardRepository.replaceContents`, W2 `PanelRepository.batchUpdate` (driven at the repository: the
 *  service folds every failure, 40P01 included, into `BadRequest`, which would hide the red), W3
 *  `OutputService.delete`. The gate is the dashboard owner. */
class PanelWriterLockOrderRaceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LockRaceSupport {

  private val owner                         = newId()
  private var appDb: JdbcBackend.Database   = _
  private var privDb: JdbcBackend.Database  = _
  private var dashboards: DashboardRepository = _
  private var panels: PanelRepository       = _
  private var outputs: OutputRepository     = _

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try seedUser(su, owner) finally su.close()
    appDb      = racePool(None)
    privDb     = racePool(Some("SET ROLE helio_privileged"))
    val dbCtx  = raceDbContext(appDb, privDb)
    dashboards = new DashboardRepository(dbCtx)
    panels     = new PanelRepository(dbCtx)
    outputs    = new OutputRepository(dbCtx)
  }

  override def afterAll(): Unit = {
    Try(appDb.close()); Try(privDb.close()); pg.close(); super.afterAll()
  }

  "a dashboard delete racing a multi-panel writer over two shared panels" should {
    "complete on both sides with no 40P01 (W1 DashboardRepository.replaceContents)" in {
      val (a, b) = twoPanelIds()
      val d      = newId()
      seedDashboardWithPanels(owner, d, Seq(b, a))
      val result = gateRace(owner, a, d)(dashboards.replaceContents(DashboardId(d), Vector.empty, DashboardLayout.Default))()
      result shouldBe ((None, None))
      exists("dashboards", d) shouldBe false
    }

    // W2's id-ordered lock skips the rows the gate deleted, so post-fix the item loop finds neither panel and the
    // repository raises exactly `NoSuchElementException("Panel '<id>' not found")`: that is the correct outcome
    // (the panels are gone), not a failure. Any other non-PSQL error is rethrown by `sqlStateAllowing`.
    "complete with no 40P01; a vanished panel is the only accepted failure (W2 PanelRepository.batchUpdate)" in {
      val (a, b) = twoPanelIds()
      val d      = newId()
      seedDashboardWithPanels(owner, d, Seq(b, a))
      // Both items carry a real patch (a title): an item with nothing to write issues only a SELECT and locks nothing.
      val items  = Vector(PanelBatchItem(b, Some("titled-b"), None, None, None), PanelBatchItem(a, Some("titled-a"), None, None, None))
      val notFound = (e: Throwable) => e match {
        case n: NoSuchElementException => Set(s"Panel '$a' not found", s"Panel '$b' not found").contains(n.getMessage)
        case _                         => false
      }
      val result = gateRace(owner, a, d)(panels.batchUpdate(items, Instant.now()))(notFound)
      result shouldBe ((None, None))
      exists("dashboards", d) shouldBe false
    }

    "complete on both sides with no 40P01 (W3 OutputService.delete)" in {
      val (a, b) = twoPanelIds()
      val d      = newId()
      val su     = superConn()
      val (_, out) = try seedPipelineWithOutput(su, owner) finally su.close()
      seedDashboardWithPanels(owner, d, Seq(b, a), Some(out))
      // accessChecker/audit are unused by `delete`.
      val service = new OutputService(outputs, panels, null)
      val result  = gateRace(owner, a, d)(service.delete(OutputId(out), AuthenticatedUser(UserId(owner))))()
      result shouldBe ((None, None))
      exists("dashboards", d) shouldBe false
    }
  }
}
