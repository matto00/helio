package com.helio.services.panels


import com.helio.services.ServiceError
import com.helio.services.panels.PanelCapabilityService
import com.helio.domain.model._
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
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

/** Service-level coverage for `PanelCapabilityService` (HEL-365, tasks 5.1-5.5), rewired
 *  HEL-904 task 3.11 onto `OutputRepository`/`NodeSnapshotRepository`.
 *
 *  Ground truth exercised here: `OutputBindingSpec` (design.md D2/D3, the `OutputKind`-keyed
 *  successor to `PanelBindingSpec`). The prior "source-companion DataType reports every kind
 *  unbindable" case (task 5.3) is RETIRED, not carried over: an Output has no source-companion
 *  concept at all (every Output is, by construction, a projection of a pipeline node) — that
 *  distinction was retired with the DataType/Metric split, so `isPipelineOutput` is now
 *  unconditionally `true` and the V41-mirroring `not-pipeline-output` branch is dead-but-harmless
 *  code, never reachable through this service. `PanelBindingSpecSpec` separately cross-checks the
 *  slot *definitions* against the frontend contract. */
class PanelCapabilityServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var outputRepo: OutputRepository             = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var service: PanelCapabilityService          = _

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
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    service          = new PanelCapabilityService(outputRepo, nodeSnapshotRepo)
    seedUsers()
  }

  private def seedUsers(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${ownerA.value}::uuid, ${s"a-${ownerA.value}@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${ownerB.value}::uuid, ${s"b-${ownerB.value}@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE outputs, node_snapshots, pipelines, data_sources RESTART IDENTITY CASCADE"))
  }

  // `data_sources` FK-references nothing, but `pipelines.source_data_source_id` (still `NOT
  // NULL` -- only `output_data_type_id` was relaxed by task 3.5) needs a real row.
  private def insertSource(owner: UserId): DataSourceId = {
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
    source.id
  }

  // `outputs.pipeline_id` FK-references `pipelines.id` — an Output needs a real pipeline row.
  private def insertPipeline(owner: UserId): PipelineId = {
    import slick.jdbc.PostgresProfile.api._
    val id  = UUID.randomUUID().toString
    val dsId = insertSource(owner)
    await(db.run(sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, owner_id, created_at, updated_at)
      VALUES ($id, 'Test Pipeline', ${dsId.value}, ${owner.value}::uuid, now(), now())"""))
    PipelineId(id)
  }

  private def insertOutput(
      pipelineId: PipelineId,
      schema: Vector[SchemaField],
      owner: UserId = ownerA,
      name: String = "MyOutput"
  ): Output =
    await(outputRepo.insertInternal(pipelineId, nodeStepId = None, ownerId = owner, name = name, kind = OutputKind.Table, schema = schema))

  private def writeRows(pipelineId: PipelineId, count: Int): Unit =
    await(nodeSnapshotRepo.overwriteRows(pipelineId.value, nodeStepId = None, Vector.fill(count)(JsObject.empty)))

  "PanelCapabilityService.getCapabilities" should {

    // Task 5.1 — spec.md "Numeric multi-row pipeline-output type"
    "mark chart/table/metric/collection bindable for a numeric multi-row pipeline-output type" in {
      cleanDb()
      val pid = insertPipeline(ownerA)
      val output = insertOutput(
        pid,
        schema = Vector(SchemaField("revenue", "float"), SchemaField("region", "string"))
      )
      writeRows(pid, count = 3)

      val result = await(service.getCapabilities(OutputId(output.id.value), userA))

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
      val pid = insertPipeline(ownerA)
      val output = insertOutput(pid, schema = Vector(SchemaField("count", "integer")))
      writeRows(pid, count = 500)

      val result = await(service.getCapabilities(OutputId(output.id.value), userA))

      result match {
        case Right(resp) =>
          resp.rowCount shouldBe 500
          resp.singleRow shouldBe false
          resp.capabilities("metric").bindable shouldBe true
          resp.capabilities("collection").bindable shouldBe true
        case other => fail(s"Expected Right, got: $other")
      }
    }

    // Task 5.4 — spec.md "Timestamp-bearing type is timeline-eligible"
    "mark timeline bindable with the timestamp column eligible for `time`" in {
      cleanDb()
      val pid = insertPipeline(ownerA)
      val output = insertOutput(
        pid,
        schema = Vector(SchemaField("occurred_at", "timestamp"), SchemaField("description", "string"))
      )
      writeRows(pid, count = 2)

      val result = await(service.getCapabilities(OutputId(output.id.value), userA))

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
      val pid    = insertPipeline(ownerA)
      val output = insertOutput(pid, schema = Vector.empty, owner = ownerA)

      val result = await(service.getCapabilities(OutputId(output.id.value), userB))

      result shouldBe Left(ServiceError.NotFound("Output not found"))
    }

    "return 404 for a nonexistent Output id" in {
      cleanDb()
      val result = await(service.getCapabilities(OutputId(UUID.randomUUID().toString), userA))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
    }
  }
}
