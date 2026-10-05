package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.routes.dashboards.PublicDashboardRoutes
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{CountingDataSource, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import scala.concurrent.ExecutionContext

/** HEL-1273 (C8): the statement count of a history request does not grow with the number of stored
 *  points. A counting `DataSource`/`Connection`/`Statement` proxy wraps BOTH pools and counts every
 *  JDBC `execute*` for exactly one request, from the route with an already-resolved caller (session
 *  authentication, which is history-independent, is excluded: `OutputRoutes` is built with a fixed
 *  user and `PublicDashboardRoutes` with `userOpt = None`). Bounds, derived in design.md D3:
 *  authenticated <= 7 (findById 2 + findConfigById 2 + 3 history reads), anonymous public <= 9. */
class OutputHistoryQueryCountSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private val appCount  = new AtomicInteger(0)
  private val privCount = new AtomicInteger(0)
  override protected def wrapApp(ds: DataSource): DataSource        = CountingDataSource.wrap(ds, appCount)
  override protected def wrapPrivileged(ds: DataSource): DataSource = CountingDataSource.wrap(ds, privCount)

  private var ownerId: String = _
  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private val AuthenticatedBound = 7
  private val PublicBound        = 9

  private val T: Instant = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)

  /** `n` points one hour apart ending at T: all inside any 7d window, so a `7d` compare has no
   *  baseline and takes the longest path (listRecent + nearestAtOrBefore + earliest). */
  private def seedOutputWithPoints(n: Int, compare: String): (String, String) = {
    val (pid, oid) = seedMetricOutput(ownerId, Some(compare))
    val entries = (0 until n).map(i =>
      historyEntry(oid, pid, T.minus((n - 1 - i).toLong, ChronoUnit.HOURS)).copy(summary = summaryOf(Some(i.toDouble)))
    )
    awaitDb(db.run(historyRepo.insertAction(entries)))
    (pid, oid)
  }

  /** (app pool executes, privileged pool executes) for ONE request, after a warm-up request. */
  private def measure(request: => Unit): (Int, Int) = {
    request
    appCount.set(0); privCount.set(0)
    request
    (appCount.get(), privCount.get())
  }

  private def authenticatedRoute(): Route =
    new OutputRoutes(outputService, AuthenticatedUser(UserId(ownerId)), Some(historyService))(harnessEc).routes

  private def authenticatedCount(oid: String): (Int, Int) = measure {
    Get(s"/outputs/$oid/history") ~> authenticatedRoute() ~> check { status shouldBe StatusCodes.OK }
  }

  private def seedPublicPanel(oid: String): (String, String) = {
    val dashId  = UUID.randomUUID().toString
    val panelId = UUID.randomUUID().toString
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashId, NULL, 'viewer', now())""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', $oid, ${ownerId}::uuid)"""
    )))
    (dashId, panelId)
  }

  private def publicCount(dashId: String, panelId: String): (Int, Int) = measure {
    val route = new PublicDashboardRoutes(
      panelRepo, aclDirective, userOpt = None, Some(outputRepo), Some(pipelineRepo), Some(snapshotRepo), None, Some(historyService)
    )(typedSystem).routes
    Get(s"/dashboards/$dashId/panels/$panelId/history") ~> route ~> check { status shouldBe StatusCodes.OK }
  }

  "the authenticated history route" should {
    "issue the same number of executes (<= 7, both pools counted) at 3 points and at 150 points" in {
      val (_, small) = seedOutputWithPoints(3, "7d")
      val (_, large) = seedOutputWithPoints(150, "7d")
      val s          = authenticatedCount(small)
      val l          = authenticatedCount(large)
      // scalastyle:off println
      println(s"[HEL-1273 count] authenticated: 3 points app=${s._1} priv=${s._2}; 150 points app=${l._1} priv=${l._2}")
      s shouldBe l
      (s._1 + s._2) should be <= AuthenticatedBound
      s._1 should be > 0 // the app pool really is counted (findById / findConfigById)
      s._2 should be > 0 // ... and so is the privileged pool (the three history reads)
    }

    "stay within the bound on the baseline-found path too" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("1d"))
      addPoint(oid, pid, T.minus(3, ChronoUnit.DAYS), Some(1))
      addPoint(oid, pid, T, Some(2))
      val c = authenticatedCount(oid)
      (c._1 + c._2) should be <= AuthenticatedBound
    }
  }

  "the public history route (anonymous caller, publicly shared dashboard)" should {
    "issue the same number of executes (<= 9, both pools counted) at 3 points and at 150 points" in {
      val (_, small) = seedOutputWithPoints(3, "7d")
      val (_, large) = seedOutputWithPoints(150, "7d")
      val (dSmall, pSmall) = seedPublicPanel(small)
      val (dLarge, pLarge) = seedPublicPanel(large)
      val s = publicCount(dSmall, pSmall)
      val l = publicCount(dLarge, pLarge)
      // scalastyle:off println
      println(s"[HEL-1273 count] public: 3 points app=${s._1} priv=${s._2}; 150 points app=${l._1} priv=${l._2}")
      s shouldBe l
      (s._1 + s._2) should be <= PublicBound
    }
  }
}
