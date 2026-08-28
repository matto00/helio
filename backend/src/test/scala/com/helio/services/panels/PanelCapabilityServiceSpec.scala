package com.helio.services.panels


import com.helio.services.ServiceError
import com.helio.services.panels.PanelCapabilityService
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Service-level coverage for `PanelCapabilityService` (HEL-365, tasks 5.1-5.5).
 *
 *  Ground truth exercised here: `PanelBindingSpec` (design.md D2/D3) and the
 *  V41 companion-rejection text `PanelService.rejectCompanionBinding` uses
 *  (`PanelService.scala:306`). `PanelBindingSpecSpec` separately
 *  cross-checks the slot *definitions* against the frontend contract. */
class PanelCapabilityServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var dataTypeRepo: DataTypeRepository       = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var service: PanelCapabilityService        = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)
  private val userA  = AuthenticatedUser(ownerA)
  private val userB  = AuthenticatedUser(ownerB)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db, db)
    dataTypeRepo    = new DataTypeRepository(ctx)
    dataTypeRowRepo = new DataTypeRowRepository(ctx)
    dataSourceRepo  = new DataSourceRepository(ctx)
    service         = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_type_rows, data_sources RESTART IDENTITY CASCADE"))
  }

  // `data_types.source_id` FK-references `data_sources.id` (V4) — a
  // companion DataType needs a real DataSource row, not just a random UUID.
  private def insertSource(owner: UserId): DataSource = {
    val now    = Instant.now()
    val source = CsvSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = "Sales CSV",
      ownerId   = owner,
      createdAt = now,
      updatedAt = now,
      config    = CsvSourceConfig("csv/test.csv")
    )
    await(dataSourceRepo.insert(source, AuthenticatedUser(owner)))
    source
  }

  private def insertDataType(
      sourceId: Option[DataSourceId],
      fields: Vector[DataField],
      owner: UserId = ownerA,
      name: String = "MyType"
  ): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = sourceId,
      name      = name,
      fields    = fields,
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt, AuthenticatedUser(owner)))
    dt
  }

  private def writeRows(dataTypeId: DataTypeId, count: Int): Unit =
    await(dataTypeRowRepo.overwriteRows(dataTypeId.value, Vector.fill(count)(JsObject.empty)))

  "PanelCapabilityService.getCapabilities" should {

    // Task 5.1 — spec.md "Numeric multi-row pipeline-output type"
    "mark chart/table/metric/collection bindable for a numeric multi-row pipeline-output type" in {
      cleanDb()
      val dt = insertDataType(
        sourceId = None,
        fields   = Vector(
          DataField("revenue", "Revenue", "float", nullable = false),
          DataField("region", "Region", "string", nullable = false)
        )
      )
      writeRows(dt.id, count = 3)

      val result = await(service.getCapabilities(dt.id, userA))

      result match {
        case Right(resp) =>
          resp.isPipelineOutput shouldBe true
          resp.rowCount shouldBe 3
          resp.singleRow shouldBe false
          resp.columns.map(_.name) should contain theSameElementsAs Vector("revenue", "region")

          val metric = resp.capabilities("metric")
          metric.bindable shouldBe true
          metric.requiredSlots shouldBe Vector("value")
          metric.optionalSlots shouldBe Vector("label", "unit")
          metric.eligibleColumns("value") shouldBe Vector("revenue")
          metric.eligibleColumns("label") should contain theSameElementsAs Vector("revenue", "region")
          metric.reason shouldBe None

          val chart = resp.capabilities("chart")
          chart.bindable shouldBe true
          chart.eligibleColumns("yAxis") shouldBe Vector("revenue")
          chart.eligibleColumns("xAxis") should contain theSameElementsAs Vector("revenue", "region")

          val table = resp.capabilities("table")
          table.bindable shouldBe true
          table.requiredSlots shouldBe empty
          table.optionalSlots shouldBe empty

          val collection = resp.capabilities("collection")
          collection.bindable shouldBe true
          collection.requiredSlots shouldBe metric.requiredSlots
          collection.optionalSlots shouldBe metric.optionalSlots
        case other => fail(s"Expected Right, got: $other")
      }
    }

    // Task 5.2 — spec.md "Single-numeric-column multi-row type is metric-eligible"
    "mark metric/collection bindable for a single-numeric-column many-row type (no row-count gate, HEL-292)" in {
      cleanDb()
      val dt = insertDataType(
        sourceId = None,
        fields   = Vector(DataField("count", "Count", "integer", nullable = false))
      )
      writeRows(dt.id, count = 500)

      val result = await(service.getCapabilities(dt.id, userA))

      result match {
        case Right(resp) =>
          resp.rowCount shouldBe 500
          resp.singleRow shouldBe false
          resp.capabilities("metric").bindable shouldBe true
          resp.capabilities("collection").bindable shouldBe true
        case other => fail(s"Expected Right, got: $other")
      }
    }

    // Task 5.3 — spec.md "Companion DataType reports no bindable data panels"
    "mark every kind not bindable, with the V41 reason, for a source-companion DataType" in {
      cleanDb()
      val source = insertSource(ownerA)
      val dt = insertDataType(
        sourceId = Some(source.id),
        fields   = Vector(DataField("revenue", "Revenue", "float", nullable = false))
      )

      val result = await(service.getCapabilities(dt.id, userA))

      result match {
        case Right(resp) =>
          resp.isPipelineOutput shouldBe false
          Vector("metric", "chart", "table", "collection", "timeline").foreach { kind =>
            val cap = resp.capabilities(kind)
            withClue(s"kind=$kind: ") {
              cap.bindable shouldBe false
              cap.eligibleColumns shouldBe empty
              cap.reason shouldBe Some("not-pipeline-output")
              // Exact literal text PanelService.rejectCompanionBinding 400s with
              // (PanelService.scala:306) — traceable to the real rejection, not a paraphrase.
              cap.message shouldBe Some("Panels can only bind to pipeline-output data types")
            }
          }
        case other => fail(s"Expected Right, got: $other")
      }
    }

    // Task 5.4 — spec.md "Timestamp-bearing type is timeline-eligible"
    "mark timeline bindable with the timestamp column eligible for `time`" in {
      cleanDb()
      val dt = insertDataType(
        sourceId = None,
        fields   = Vector(
          DataField("occurred_at", "Occurred At", "timestamp", nullable = false),
          DataField("description", "Description", "string", nullable = false)
        )
      )
      writeRows(dt.id, count = 2)

      val result = await(service.getCapabilities(dt.id, userA))

      result match {
        case Right(resp) =>
          val timeline = resp.capabilities("timeline")
          timeline.bindable shouldBe true
          timeline.requiredSlots shouldBe Vector("time", "event")
          timeline.eligibleColumns("time") shouldBe Vector("occurred_at")
          timeline.eligibleColumns("event") should contain theSameElementsAs Vector("occurred_at", "description")
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "return 404 (never 403) for a cross-tenant caller" in {
      cleanDb()
      val dt = insertDataType(sourceId = None, fields = Vector.empty, owner = ownerA)

      val result = await(service.getCapabilities(dt.id, userB))

      result shouldBe Left(ServiceError.NotFound("DataType not found"))
    }

    "return 404 for a nonexistent DataType id" in {
      cleanDb()
      val result = await(service.getCapabilities(DataTypeId(UUID.randomUUID().toString), userA))
      result shouldBe Left(ServiceError.NotFound("DataType not found"))
    }
  }
}
