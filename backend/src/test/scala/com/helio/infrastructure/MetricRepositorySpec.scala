package com.helio.infrastructure

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.domain.model._
import com.helio.domain.panels.{MetricPanel, MetricPanelConfig}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-446 — `MetricRepository` CRUD round-trip, owner scoping, CASCADE
 *  delete from the bound `DataType`, and `aggregation` allow-list
 *  validation at the insert/update boundary. HEL-560 tasks.md 8.1 adds the
 *  "where used" query (`usage`/`countBoundPanels`) coverage. */
class MetricRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var metricRepo: MetricRepository       = _
  private var dtRepo: DataTypeRepository         = _
  private var panelRepo: PanelRepository         = _
  private var dashboardRepo: DashboardRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    metricRepo = new MetricRepository(ctx)
    dtRepo = new DataTypeRepository(ctx)
    panelRepo = new PanelRepository(ctx)
    dashboardRepo = new DashboardRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM panels"))
    await(db.run(sqlu"DELETE FROM dashboards"))
    await(db.run(sqlu"DELETE FROM metrics"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private def seedDashboard(ownerId: UserId): DashboardId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Usage Test Dashboard', ${ownerId.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId.value}::uuid)"""
    ))
    DashboardId(id)
  }

  private def seedBoundPanel(
      metricId: MetricId,
      dashboardId: DashboardId,
      ownerId: UserId,
      title: String = "Bound Panel"
  ): PanelId = {
    val panelId = PanelId(UUID.randomUUID().toString)
    val panel = MetricPanel(
      panelId,
      dashboardId,
      title,
      ResourceMeta(ownerId.value, Instant.now(), Instant.now()),
      PanelAppearance.Default,
      ownerId,
      MetricPanelConfig(dataTypeId = DataTypeId(""), fieldMapping = JsObject.empty, metricId = Some(metricId))
    )
    await(panelRepo.insert(panel))
    panelId
  }

  private val owner1Id = UUID.randomUUID().toString
  private val owner2Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val owner2   = UserId(owner2Id)
  private val user1    = AuthenticatedUser(owner1)
  private val user2    = AuthenticatedUser(owner2)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"a-$owner1Id@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner2Id::uuid, ${s"b-$owner2Id@helio.test"}, now())"""
    )))
  }

  private def newDataType(ownerId: UserId): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "MyType",
      fields    = Vector(DataField("revenue", "Revenue", "number", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = ownerId
    )
  }

  private def newMetric(
      ownerId: UserId,
      dataTypeId: DataTypeId,
      aggregation: String = "sum",
      name: String = "Total Revenue",
      createdAt: Instant = Instant.now()
  ): MetricDefinition =
    MetricDefinition(
      id                = MetricId(UUID.randomUUID().toString),
      ownerId           = ownerId,
      dataTypeId        = dataTypeId,
      name              = name,
      description       = Some("A test metric"),
      measureField      = "revenue",
      aggregation       = aggregation,
      allowedDimensions = Vector("region"),
      format            = MetricFormat(unit = Some("USD"), decimals = Some(2), prefix = None, suffix = None),
      deprecated        = false,
      createdAt         = createdAt,
      updatedAt         = createdAt
    )

  "MetricRepository" should {

    "insert then findByIdOwned round-trips every field" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)

      val inserted = await(metricRepo.insert(metric, user1))
      inserted shouldBe Right(metric)

      val found = await(metricRepo.findByIdOwned(metric.id, user1))
      found shouldBe defined
      found.get.id                shouldBe metric.id
      found.get.ownerId           shouldBe owner1
      found.get.dataTypeId        shouldBe dt.id
      found.get.name              shouldBe "Total Revenue"
      found.get.description       shouldBe Some("A test metric")
      found.get.measureField      shouldBe "revenue"
      found.get.aggregation       shouldBe "sum"
      found.get.allowedDimensions shouldBe Vector("region")
      found.get.format            shouldBe MetricFormat(Some("USD"), Some(2), None, None)
      found.get.deprecated        shouldBe false
    }

    "findByIdOwned returns None for unknown id" in {
      cleanDb(); seedUsers()
      val result = await(metricRepo.findByIdOwned(MetricId(UUID.randomUUID().toString), user1))
      result shouldBe None
    }

    "listByOwner returns only metrics owned by the given user" in {
      cleanDb(); seedUsers()
      val dt1 = await(dtRepo.insert(newDataType(owner1), user1))
      val dt2 = await(dtRepo.insert(newDataType(owner2), user2))
      val metricA = newMetric(owner1, dt1.id, name = "A")
      val metricB = newMetric(owner1, dt1.id, name = "B")
      val metricC = newMetric(owner2, dt2.id, name = "C")
      await(metricRepo.insert(metricA, user1))
      await(metricRepo.insert(metricB, user1))
      await(metricRepo.insert(metricC, user2))

      val forOwner1 = await(metricRepo.listByOwner(user1))
      forOwner1.map(_.id) should contain allOf (metricA.id, metricB.id)
      forOwner1.map(_.id) should not contain metricC.id

      val forOwner2 = await(metricRepo.listByOwner(user2))
      forOwner2.map(_.id) should contain only metricC.id
    }

    // No repository-level "listByOwner is invisible to the other owner via
    // real Postgres RLS" assertion here — this suite's `DbContext` runs both
    // pools through the embedded Postgres default "postgres" superuser (see
    // `beforeAll`), and PostgreSQL superusers unconditionally bypass row
    // level security (including FORCE ROW LEVEL SECURITY) regardless of
    // policy content. This is the same documented dev/CI RLS-testing gap
    // that applies to every other owner-scoped repository in this codebase
    // (see `AlertRuleRepositorySpec`). The assertions above only prove the
    // app-layer `WHERE owner_id = ?` scoping baked into `listByOwner`/
    // `findByIdOwned`, not real Postgres RLS enforcement.
    "findByIdOwned excludes another owner's metric (app-layer owner scoping)" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val foundByOwner    = await(metricRepo.findByIdOwned(metric.id, user1))
      val foundByNonOwner = await(metricRepo.findByIdOwned(metric.id, user2))

      foundByOwner shouldBe defined
      foundByNonOwner shouldBe None
    }

    "update mutates fields and bumps updatedAt" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val updated = metric.copy(
        name              = "Renamed",
        description       = None,
        aggregation       = "avg",
        allowedDimensions = Vector("region", "product"),
        format            = MetricFormat(None, None, None, Some("/mo")),
        deprecated        = true,
        updatedAt         = Instant.now().plusSeconds(60)
      )
      val result = await(metricRepo.update(updated, user1))

      result shouldBe a[Right[_, _]]
      val row = result.toOption.flatten
      row shouldBe defined
      row.get.name              shouldBe "Renamed"
      row.get.description       shouldBe None
      row.get.aggregation       shouldBe "avg"
      row.get.allowedDimensions shouldBe Vector("region", "product")
      row.get.format            shouldBe MetricFormat(None, None, None, Some("/mo"))
      row.get.deprecated        shouldBe true
    }

    "update returns Right(None) for unknown id" in {
      cleanDb(); seedUsers()
      val dt      = await(dtRepo.insert(newDataType(owner1), user1))
      val phantom = newMetric(owner1, dt.id)
      val result  = await(metricRepo.update(phantom, user1))
      result shouldBe Right(None)
    }

    "delete removes the row and returns true" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val deleted = await(metricRepo.delete(metric.id, user1))
      deleted shouldBe true
      await(metricRepo.findByIdOwned(metric.id, user1)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb(); seedUsers()
      val result = await(metricRepo.delete(MetricId(UUID.randomUUID().toString), user1))
      result shouldBe false
    }

    "deleting the bound DataType cascades and removes the metric" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      await(dtRepo.delete(dt.id, user1))

      await(metricRepo.findByIdOwned(metric.id, user1)) shouldBe None
    }

    "findByIdInternal bypasses per-owner RLS and returns a metric regardless of caller" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val result = await(metricRepo.findByIdInternal(metric.id))
      result shouldBe defined
      result.get.id shouldBe metric.id
    }

    "findByIdInternal returns None for unknown id" in {
      cleanDb(); seedUsers()
      val result = await(metricRepo.findByIdInternal(MetricId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "insert rejects an unknown aggregation with a descriptive Left and writes no row" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id, aggregation = "median")

      val result = await(metricRepo.insert(metric, user1))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("median")

      await(metricRepo.findByIdOwned(metric.id, user1)) shouldBe None
    }

    "update rejects an unknown aggregation with a descriptive Left and does not mutate the row" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val badUpdate = metric.copy(aggregation = "median", name = "Should Not Apply")
      val result    = await(metricRepo.update(badUpdate, user1))
      result shouldBe a[Left[_, _]]

      val unchanged = await(metricRepo.findByIdOwned(metric.id, user1))
      unchanged.get.name        shouldBe metric.name
      unchanged.get.aggregation shouldBe metric.aggregation
    }

    // ── HEL-500 T.5: findByIdsOwned batch lookup, mirrors DataTypeRepositorySpec's ──

    "findByIdsOwned returns only metrics owned by the given user" in {
      cleanDb(); seedUsers()
      val dt1     = await(dtRepo.insert(newDataType(owner1), user1))
      val dt2     = await(dtRepo.insert(newDataType(owner2), user2))
      val metric1 = newMetric(owner1, dt1.id, name = "A")
      val metric2 = newMetric(owner1, dt1.id, name = "B")
      val metric3 = newMetric(owner2, dt2.id, name = "C")
      await(metricRepo.insert(metric1, user1))
      await(metricRepo.insert(metric2, user1))
      await(metricRepo.insert(metric3, user2))

      val result = await(metricRepo.findByIdsOwned(Seq(metric1.id, metric2.id, metric3.id), user1))
      result.keySet shouldBe Set(metric1.id, metric2.id)
      result(metric1.id).name shouldBe "A"
      result(metric2.id).name shouldBe "B"
      result.get(metric3.id) shouldBe None
    }

    "findByIdsOwned excludes all metrics when caller owns none" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner2), user2))
      val metric = newMetric(owner2, dt.id)
      await(metricRepo.insert(metric, user2))

      val result = await(metricRepo.findByIdsOwned(Seq(metric.id), user1))
      result shouldBe Map.empty
    }

    "findByIdsOwned short-circuits with empty map for empty input" in {
      cleanDb(); seedUsers()
      val result = await(metricRepo.findByIdsOwned(Seq.empty, user1))
      result shouldBe Map.empty
    }

    "accepts every allow-listed aggregation value" in {
      cleanDb(); seedUsers()
      val dt = await(dtRepo.insert(newDataType(owner1), user1))

      MetricAggregation.values.foreach { agg =>
        val metric = newMetric(owner1, dt.id, aggregation = agg, name = s"Metric-$agg")
        val result = await(metricRepo.insert(metric, user1))
        result shouldBe Right(metric)
      }
    }
  }

  "MetricRepository.findAll" should {

    "pages results DB-side (offset/limit) and returns the caller's full total" in {
      cleanDb(); seedUsers()
      val dt = await(dtRepo.insert(newDataType(owner1), user1))
      val base = Instant.now()
      // Explicit, strictly-increasing createdAt per row (rather than relying
      // on wall-clock gaps between sequential inserts) so ordering assertions
      // below are deterministic — findAll sorts most-recently-created first,
      // mirroring listByOwner/DataTypeRepository.findAll.
      val names = Vector("A", "B", "C", "D", "E")
      names.zipWithIndex.foreach { case (n, i) =>
        await(metricRepo.insert(newMetric(owner1, dt.id, name = n, createdAt = base.plusSeconds(i)), user1))
      }

      val firstPage = await(metricRepo.findAll(owner1, Page(offset = 0, limit = 2)))
      firstPage.items    should have size 2
      firstPage.total    shouldBe 5
      firstPage.offset   shouldBe 0
      firstPage.limit    shouldBe 2
      firstPage.items.map(_.name) shouldBe Vector("E", "D")

      val secondPage = await(metricRepo.findAll(owner1, Page(offset = 2, limit = 2)))
      secondPage.items should have size 2
      secondPage.total shouldBe 5
      secondPage.items.map(_.name) shouldBe Vector("C", "B")

      val lastPage = await(metricRepo.findAll(owner1, Page(offset = 4, limit = 2)))
      lastPage.items should have size 1
      lastPage.total shouldBe 5
      lastPage.items.map(_.name) shouldBe Vector("A")
    }

    "scopes results to the caller's own metrics" in {
      cleanDb(); seedUsers()
      val dt1 = await(dtRepo.insert(newDataType(owner1), user1))
      val dt2 = await(dtRepo.insert(newDataType(owner2), user2))
      await(metricRepo.insert(newMetric(owner1, dt1.id, name = "A"), user1))
      await(metricRepo.insert(newMetric(owner1, dt1.id, name = "B"), user1))
      await(metricRepo.insert(newMetric(owner2, dt2.id, name = "C"), user2))

      val forOwner1 = await(metricRepo.findAll(owner1, Page(offset = 0, limit = 10)))
      forOwner1.total shouldBe 2
      forOwner1.items.map(_.name) should contain allOf ("A", "B")
      forOwner1.items.map(_.name) should not contain "C"

      val forOwner2 = await(metricRepo.findAll(owner2, Page(offset = 0, limit = 10)))
      forOwner2.total shouldBe 1
      forOwner2.items.map(_.name) should contain only "C"
    }

    "returns an empty page with total 0 when the owner has no metrics" in {
      cleanDb(); seedUsers()
      val result = await(metricRepo.findAll(owner1, Page(offset = 0, limit = 10)))
      result.items shouldBe empty
      result.total shouldBe 0
    }
  }

  // ── HEL-560 tasks.md 8.1: "where used" query ────────────────────────────────

  "MetricRepository.usage" should {

    "returns the panels + dashboards bound to a metric, owner-scoped" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val dashA = seedDashboard(owner1)
      val dashB = seedDashboard(owner1)
      val panelA = seedBoundPanel(metric.id, dashA, owner1, title = "Panel A")
      val panelB = seedBoundPanel(metric.id, dashB, owner1, title = "Panel B")

      val result = await(metricRepo.usage(metric.id, user1))

      result should have size 2
      result.map(_.panelId) should contain allOf (panelA, panelB)
      val entryA = result.find(_.panelId == panelA).get
      entryA.panelTitle shouldBe "Panel A"
      entryA.dashboardId shouldBe dashA
      entryA.dashboardName shouldBe "Usage Test Dashboard"
    }

    "returns an empty vector for a metric with no bound panels" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val result = await(metricRepo.usage(metric.id, user1))
      result shouldBe empty
    }

    "never returns another owner's panels, even if bound to the same metric id" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val dashOwnedByA = seedDashboard(owner1)
      val dashOwnedByB = seedDashboard(owner2)
      seedBoundPanel(metric.id, dashOwnedByA, owner1, title = "Owned by A")
      // A cross-owner row that shouldn't exist via the normal create/update
      // path (service-layer validation would clear a foreign metricId on
      // read) — inserted directly at the repository layer to prove the join
      // itself scopes on the CALLER's owner_id, not just the metric's.
      seedBoundPanel(metric.id, dashOwnedByB, owner2, title = "Owned by B")

      val result = await(metricRepo.usage(metric.id, user1))
      result should have size 1
      result.head.panelTitle shouldBe "Owned by A"
    }
  }

  "MetricRepository.countBoundPanels" should {

    "returns the same count as usage.size" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val dash = seedDashboard(owner1)
      seedBoundPanel(metric.id, dash, owner1)
      seedBoundPanel(metric.id, dash, owner1)

      val count = await(metricRepo.countBoundPanels(metric.id, user1))
      count shouldBe 2
    }

    "returns 0 for an unbound metric" in {
      cleanDb(); seedUsers()
      val dt     = await(dtRepo.insert(newDataType(owner1), user1))
      val metric = newMetric(owner1, dt.id)
      await(metricRepo.insert(metric, user1))

      val count = await(metricRepo.countBoundPanels(metric.id, user1))
      count shouldBe 0
    }
  }

  "MetricAggregation.validate" should {

    "accept every allow-listed value" in {
      MetricAggregation.values.foreach { agg =>
        MetricAggregation.validate(agg) shouldBe Right(agg)
      }
    }

    "reject an unknown value with a descriptive error naming the value and the allow-list" in {
      val result = MetricAggregation.validate("median")
      result shouldBe a[Left[_, _]]
      val err = result.left.toOption.get
      err should include("median")
      MetricAggregation.values.foreach(v => err should include(v))
    }
  }
}
