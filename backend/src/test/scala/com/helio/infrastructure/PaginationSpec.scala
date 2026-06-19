package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import slick.jdbc.PostgresProfile.api._

/** Tests for the pagination behaviour added by HEL-133.
 *
 *  Covers tasks 7.1-7.4 (repository layer: items slice, total, offset/limit
 *  round-trip) for all four affected repositories. */
class PaginationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var ctx: DbContext                        = _
  private var dashRepo: DashboardRepository        = _
  private var dtRepo: DataTypeRepository           = _
  private var dsRepo: DataSourceRepository         = _
  private var panelRepo: PanelRepository           = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db       = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx      = new DbContext(db, db)
    dashRepo  = new DashboardRepository(ctx)
    dtRepo    = new DataTypeRepository(ctx)
    dsRepo    = new DataSourceRepository(ctx)
    panelRepo = new PanelRepository(ctx)

    // dashboards and panels have owner_id REFERENCES users(id), so the test
    // owner must exist in users before any insert.  The postgres superuser
    // connection bypasses RLS, so a raw db.run is safe here.
    Await.result(
      db.run(sqlu"""INSERT INTO users (id, email, created_at)
                    VALUES (${ownerId.value}::uuid, ${s"${ownerId.value}@test.local"}, now())
                    ON CONFLICT DO NOTHING"""),
      5.seconds
    )
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    await(db.run(sqlu"DELETE FROM panels"))
    await(db.run(sqlu"DELETE FROM dashboards"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  // ── Helpers ────────────────────────────────────────────────────────────────

  private def newDashboard(name: String = "Dash"): Dashboard = {
    val now = Instant.now()
    Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = name,
      meta       = ResourceMeta(ownerId.value, now, now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = ownerId
    )
  }

  private def newDataType(name: String = "Type"): DataType = {
    val now = Instant.now()
    DataType(
      id             = DataTypeId(UUID.randomUUID().toString),
      sourceId       = None,
      name           = name,
      fields         = Vector.empty,
      version        = 1,
      createdAt      = now,
      updatedAt      = now,
      ownerId        = ownerId
    )
  }

  private def newDataSource(name: String = "Source"): DataSource = {
    val now = Instant.now()
    RestSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = name,
      ownerId   = ownerId,
      createdAt = now,
      updatedAt = now,
      config    = RestApiConfig(url = "https://example.test", method = "GET")
    )
  }

  private def insertDashboard(name: String = "Dash"): DashboardId = {
    val d = newDashboard(name)
    await(dashRepo.insert(d))
    d.id
  }

  // ── DashboardRepository pagination (task 7.1) ─────────────────────────────

  "DashboardRepository.findAll pagination" should {

    "return correct items slice, total, offset, and limit" in {
      cleanDb()
      (1 to 5).foreach(i => await(dashRepo.insert(newDashboard(s"D$i"))))

      val result = await(dashRepo.findAll(ownerId, Page(offset = 1, limit = 2)))

      result.total  shouldBe 5
      result.offset shouldBe 1
      result.limit  shouldBe 2
      result.items  should have size 2
    }

    "return all items when limit exceeds total" in {
      cleanDb()
      (1 to 3).foreach(i => await(dashRepo.insert(newDashboard(s"D$i"))))

      val result = await(dashRepo.findAll(ownerId, Page.Default))

      result.total shouldBe 3
      result.items should have size 3
    }

    "return empty items for offset beyond total" in {
      cleanDb()
      (1 to 3).foreach(i => await(dashRepo.insert(newDashboard(s"D$i"))))

      val result = await(dashRepo.findAll(ownerId, Page(offset = 10, limit = 5)))

      result.total shouldBe 3
      result.items shouldBe empty
    }

    "return zero total for a user with no dashboards" in {
      cleanDb()
      val otherOwner = UserId(UUID.randomUUID().toString)
      val result = await(dashRepo.findAll(otherOwner, Page.Default))

      result.total shouldBe 0
      result.items shouldBe empty
    }
  }

  // ── DataTypeRepository pagination (task 7.2) ──────────────────────────────

  "DataTypeRepository.findAll pagination" should {

    "return correct items slice, total, offset, and limit" in {
      cleanDb()
      (1 to 5).foreach(i => await(dtRepo.insert(newDataType(s"T$i"), user)))

      val result = await(dtRepo.findAll(ownerId, Page(offset = 2, limit = 2)))

      result.total  shouldBe 5
      result.offset shouldBe 2
      result.limit  shouldBe 2
      result.items  should have size 2
    }

    "return all items with Page.Default" in {
      cleanDb()
      (1 to 4).foreach(i => await(dtRepo.insert(newDataType(s"T$i"), user)))

      val result = await(dtRepo.findAll(ownerId, Page.Default))

      result.total shouldBe 4
      result.items should have size 4
    }

    "return zero total for a user with no data types" in {
      cleanDb()
      val otherOwner = UserId(UUID.randomUUID().toString)
      val result = await(dtRepo.findAll(otherOwner, Page.Default))

      result.total shouldBe 0
      result.items shouldBe empty
    }
  }

  // ── DataSourceRepository pagination (task 7.3) ────────────────────────────

  "DataSourceRepository.findAll pagination" should {

    "return correct items slice, total, offset, and limit" in {
      cleanDb()
      (1 to 5).foreach(i => await(dsRepo.insert(newDataSource(s"S$i"), user)))

      val result = await(dsRepo.findAll(ownerId, Page(offset = 0, limit = 3)))

      result.total  shouldBe 5
      result.offset shouldBe 0
      result.limit  shouldBe 3
      result.items  should have size 3
    }

    "return all items with Page.Default" in {
      cleanDb()
      (1 to 4).foreach(i => await(dsRepo.insert(newDataSource(s"S$i"), user)))

      val result = await(dsRepo.findAll(ownerId, Page.Default))

      result.total shouldBe 4
      result.items should have size 4
    }

    "return zero total for a user with no data sources" in {
      cleanDb()
      val otherOwner = UserId(UUID.randomUUID().toString)
      val result = await(dsRepo.findAll(otherOwner, Page.Default))

      result.total shouldBe 0
      result.items shouldBe empty
    }
  }

  // ── PanelRepository pagination (task 7.4) ────────────────────────────────

  "PanelRepository.findAllByDashboardId pagination" should {

    "return correct items slice, total, offset, and limit for the owner" in {
      cleanDb()
      val dashId = insertDashboard()
      val now    = Instant.now()

      (1 to 5).foreach { i =>
        await(db.run(sqlu"""
          INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
          VALUES (${UUID.randomUUID().toString}, ${dashId.value}, ${"Panel " + i}, ${ownerId.value}, now(), now(),
                  '{"background":"transparent","color":"inherit","transparency":0.0}', 'metric',
                  ${UUID.fromString(ownerId.value).toString}::uuid)
        """))
      }

      val result = await(panelRepo.findAllByDashboardId(dashId, Some(user), Page(offset = 1, limit = 2)))

      result.total  shouldBe 5
      result.offset shouldBe 1
      result.limit  shouldBe 2
      result.items  should have size 2
    }

    "return zero total for a non-existent dashboard" in {
      cleanDb()
      val unknownDashId = DashboardId(UUID.randomUUID().toString)
      val result = await(panelRepo.findAllByDashboardId(unknownDashId, Some(user), Page.Default))

      result.total shouldBe 0
      result.items shouldBe empty
    }
  }
}
