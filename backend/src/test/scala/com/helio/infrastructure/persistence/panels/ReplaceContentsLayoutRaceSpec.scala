package com.helio.infrastructure.persistence.panels

import com.helio.domain.model._
import com.helio.domain.panels.{TextPanel, TextPanelConfig}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.panels.{ItemSize, PlacementSizes}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.util.Try

/** HEL-1526 (folded into HEL-1498): `replaceContents` must never overwrite a layout it did not read.
 *
 *  RED proof (pre-fix): on a dashboard that starts with ZERO panels, `replaceContents`' panel DELETE removes
 *  nothing, so V122 never locks the dashboard; it read the dashboard row unlocked and later writes a layout back.
 *  A panel created in that window keeps its row but loses its layout item.
 *
 *  Interleave (driven by observed per-racer lock waits, never sleeps; start order gate, replace, create): a gate
 *  session (the schema owner / superuser, which SHARE mode requires) holds `LOCK TABLE panels IN SHARE MODE`. That
 *  blocks `replaceContents` at its panel DELETE (ROW EXCLUSIVE) before it takes any dashboard-row lock (pre-fix);
 *  a real concurrent `insertPlaced` takes the dashboard row `FOR UPDATE` and blocks on its own panel INSERT
 *  (pre-fix; post-fix it waits on the dashboard row `replaceContents` already holds). Then the gate commits.
 *  Pre-fix the create commits first and replace's layout overwrites it (RED); post-fix replace's lock serializes
 *  the two and both commit consistently. The race asserts only panel/item agreement and clean completion: the create
 *  commits after replace and V127 bumps the version again, so it cannot check replace's returned version.
 *
 *  The GUARD-free second case does not race: it replaces with a layout DIFFERENT from the stored one (V127 bumps
 *  only on change) and asserts the returned `layoutVersion` equals the stored version (RED pre-fix: the response
 *  was a copy of the pre-read row). The gate is a TEST-HARNESS device only; it needs no production change. */
class ReplaceContentsLayoutRaceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LockRaceSupport {

  private val owner = newId()
  private var pools: Vector[JdbcBackend.Database] = Vector.empty
  private var replaceRepo: DashboardRepository    = _
  private var createRepo: PanelRepository         = _

  private def namedPool(name: String, init: Option[String]): JdbcBackend.Database = {
    val db = racePool(init, Some(name)); pools = pools :+ db; db
  }

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try seedUser(su, owner) finally su.close()
    replaceRepo = new DashboardRepository(raceDbContext(namedPool("replace-app", None), namedPool("replace-priv", Some("SET ROLE helio_privileged"))))
    createRepo  = new PanelRepository(raceDbContext(namedPool("create-app", None), namedPool("create-priv", Some("SET ROLE helio_privileged"))))
  }

  override def afterAll(): Unit = {
    pools.foreach(p => Try(p.close())); pg.close(); super.afterAll()
  }

  private def textPanel(id: String, dashboard: String): TextPanel = {
    val now = Instant.now()
    TextPanel(PanelId(id), DashboardId(dashboard), "t", ResourceMeta(owner, now, now), PanelAppearance.Default, UserId(owner), TextPanelConfig.Empty)
  }

  private def layoutWith(id: String): DashboardLayout = {
    val items = Vector(DashboardLayoutItem(PanelId(id), 0, 0, 4, 5))
    DashboardLayout(items, items, items, items)
  }

  // The single call site the HEL-1526 signature change (`layout: DashboardLayout`, no longer an Option) edits.
  private def replace(dashboard: String, panels: Vector[Panel], layout: DashboardLayout) =
    replaceRepo.replaceContents(DashboardId(dashboard), panels, layout)

  private def panelIdsOn(dashboard: String): Set[String] = {
    val su = superConn()
    try rows(su, s"SELECT id FROM panels WHERE dashboard_id = '$dashboard'")(_.getString(1)).toSet finally su.close()
  }

  "replaceContents racing a panel create on a dashboard that starts empty" should {
    "leave every panel with a layout item in every breakpoint and fail on neither side" in {
      val d = newId()
      seedDashboardWithPanels(owner, d, Seq.empty)
      val created = newId()
      val sizes   = PlacementSizes(ItemSize(4, 5), ItemSize(4, 5), ItemSize(4, 5), ItemSize(4, 5))

      val gate = superConn()
      try {
        gate.setAutoCommit(false)
        exec(gate, "LOCK TABLE panels IN SHARE MODE")
        val replaceSide = replace(d, Vector.empty, DashboardLayout.Default)
        awaitLockWaitOf("replace-", replaceSide)
        val createSide = createRepo.insertPlaced(textPanel(created, d), sizes)
        awaitLockWaitOf("create-", createSide)
        gate.commit()

        val states = (sqlState(replaceSide), sqlState(createSide))
        states shouldBe ((None, None))
      } finally gate.close()

      val stored = {
        val su = superConn()
        try storedLayout(su, d) finally su.close()
      }
      val panelIds = panelIdsOn(d)
      Bps.foreach(bp => withClue(s"breakpoint $bp: ")(panelIdsIn(stored, bp).toSet shouldBe panelIds))
    }
  }

  "a non-racing replaceContents with a layout different from the stored one" should {
    "return the layout version that is stored" in {
      val d = newId()
      seedDashboardWithPanels(owner, d, Seq.empty)
      val p      = newId()
      val result = Await.result(replace(d, Vector(textPanel(p, d)), layoutWith(p)), 30.seconds)
      val stored = {
        val su = superConn()
        try rows(su, s"SELECT layout_version FROM dashboards WHERE id = '$d'")(_.getLong(1)).head finally su.close()
      }
      stored should be > 0L
      result.map(_._1.layoutVersion) shouldBe Some(stored)
    }
  }
}
