package com.helio.spark

import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineRunRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class SparkJobSubmitterSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  // In-memory mock DataSourceRepository — serves the static-payload JSON the
  // `staticDs` helper stashes for each test. The Spark submitter reads the
  // payload via `readRawConfig` (rather than off the ADT itself, which is
  // identity-only for StaticSource).
  private val staticPayloads = scala.collection.mutable.Map.empty[String, String]
  private val mockDsRepo = new DataSourceRepository(null) {
    override def readRawConfig(id: DataSourceId): Future[Option[String]] =
      Future.successful(staticPayloads.get(id.value))
  }

  // Use local mode to avoid external cluster dependency in tests.
  // pipelineRepo is null here — these tests exercise DataFrame ops only, not DB persistence.
  private val submitter = new SparkJobSubmitter("local[*]", mockDsRepo, null)

  /** Build a `StaticSource` with the given columns and rows. The `{columns,
   *  rows}` JSON payload is stashed in `staticPayloads` keyed by id so the
   *  mock repo's `readRawConfig` can serve it back. */
  private def staticDs(
      cols: Seq[(String, String)],
      rows: Seq[Seq[JsValue]],
      idOverride: Option[String] = None
  ): DataSource = {
    val id      = DataSourceId(idOverride.getOrElse(java.util.UUID.randomUUID().toString))
    val colJson = JsArray(cols.map { case (n, t) =>
      JsObject("name" -> JsString(n), "type" -> JsString(t))
    }.toVector)
    val rowJson = JsArray(rows.map(r => JsArray(r.toVector)).toVector)
    val payload = JsObject("columns" -> colJson, "rows" -> rowJson).compactPrint
    staticPayloads(id.value) = payload
    StaticSource(
      id        = id,
      name      = "test-source",
      ownerId   = UserId("user-1"),
      createdAt = Instant.now(),
      updatedAt = Instant.now()
    )
  }

  // Helper: build a typed PipelineStep (CS2c-3a ADT).
  private def stepId(pos: Int): PipelineStepId = PipelineStepId(s"step-$pos")
  private val pipeId: PipelineId               = PipelineId("pipeline-1")
  private def now: Instant                     = Instant.now()

  private def renameStep(renames: Map[String, String], pos: Int = 0): PipelineStep =
    RenameStep(stepId(pos), pipeId, pos, RenameConfig(renames), now, now)
  private def filterStep(combinator: String, conditions: Vector[FilterCondition], pos: Int = 0): PipelineStep =
    FilterStep(stepId(pos), pipeId, pos, FilterConfig(combinator, conditions), now, now)
  private def computeStep(column: String, expression: String, pos: Int = 0): PipelineStep =
    ComputeStep(stepId(pos), pipeId, pos, ComputeConfig(column, expression, None), now, now)
  private def groupByStep(groupBy: Vector[String], aggColumn: String, aggFn: String, pos: Int = 0): PipelineStep =
    GroupByStep(stepId(pos), pipeId, pos, GroupByConfig(groupBy, aggColumn, aggFn), now, now)
  private def castStep(casts: Map[String, String], pos: Int = 0): PipelineStep =
    CastStep(stepId(pos), pipeId, pos, CastConfig(casts), now, now)
  private def selectStep(fields: Vector[String], pos: Int = 0): PipelineStep =
    SelectStep(stepId(pos), pipeId, pos, SelectConfig(fields), now, now)

  "loadDataFrame" should {
    "load a static DataSource into a DataFrame" in {
      val ds = staticDs(
        Seq("name" -> "string", "age" -> "integer"),
        Seq(Seq(JsString("Alice"), JsNumber(30)), Seq(JsString("Bob"), JsNumber(25)))
      )
      val df = submitter.loadDataFrame(ds)
      df.count() shouldBe 2
      df.schema.fieldNames should contain allOf ("name", "age")
    }

    "throw for unsupported rest_api source type" in {
      val ds = RestSource(
        id        = DataSourceId("ds-2"),
        name      = "rest",
        ownerId   = UserId("user-1"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(url = "https://example.test", method = "GET")
      )
      an[IllegalArgumentException] should be thrownBy submitter.loadDataFrame(ds)
    }
  }

  "applyStep" when {

    "op is rename" should {
      "rename a column" in {
        val ds = staticDs(Seq("first_name" -> "string"), Seq(Seq(JsString("Alice"))))
        val df = submitter.loadDataFrame(ds)
        val s  = renameStep(Map("first_name" -> "name"))
        val result = submitter.applyStep(df, s)
        result.schema.fieldNames should contain ("name")
        result.schema.fieldNames should not contain "first_name"
      }
    }

    "op is filter" should {
      "filter rows by typed conditions" in {
        val ds = staticDs(
          Seq("age" -> "integer"),
          Seq(Seq(JsNumber(20)), Seq(JsNumber(35)), Seq(JsNumber(28)))
        )
        val df     = submitter.loadDataFrame(ds)
        val s      = filterStep("AND", Vector(FilterCondition("age", ">", Some("25"))))
        val result = submitter.applyStep(df, s)
        result.count() shouldBe 2
      }
    }

    "op is compute" should {
      "add a computed column" in {
        val ds = staticDs(
          Seq("price" -> "double", "qty" -> "integer"),
          Seq(Seq(JsNumber(10.0), JsNumber(3)))
        )
        val df     = submitter.loadDataFrame(ds)
        val s      = computeStep("total", "price * qty")
        val result = submitter.applyStep(df, s)
        result.schema.fieldNames should contain ("total")
        result.collect().head.getAs[Double]("total") shouldBe 30.0 +- 0.001
      }
    }

    "op is groupby" should {
      "group and aggregate with sum" in {
        val ds = staticDs(
          Seq("dept" -> "string", "salary" -> "double"),
          Seq(
            Seq(JsString("eng"), JsNumber(100.0)),
            Seq(JsString("eng"), JsNumber(200.0)),
            Seq(JsString("hr"),  JsNumber(150.0))
          )
        )
        val df     = submitter.loadDataFrame(ds)
        val result = submitter.applyStep(df, groupByStep(Vector("dept"), "salary", "sum"))
        result.count() shouldBe 2
        result.schema.fieldNames should contain ("sum_salary")
      }

      "support avg, min, max functions" in {
        val ds = staticDs(
          Seq("g" -> "string", "v" -> "double"),
          Seq(Seq(JsString("a"), JsNumber(10.0)), Seq(JsString("a"), JsNumber(20.0)))
        )
        val df = submitter.loadDataFrame(ds)
        Seq("avg", "min", "max").foreach { fn =>
          submitter.applyStep(df, groupByStep(Vector("g"), "v", fn)).count() shouldBe 1L
        }
      }

      "throw for unknown aggFunction" in {
        val ds = staticDs(Seq("g" -> "string", "v" -> "double"), Seq(Seq(JsString("a"), JsNumber(1.0))))
        val df = submitter.loadDataFrame(ds)
        an[IllegalArgumentException] should be thrownBy
          submitter.applyStep(df, groupByStep(Vector("g"), "v", "mode"))
      }
    }

    "op is cast" should {
      "cast a column to a new data type" in {
        val ds     = staticDs(Seq("age" -> "string"), Seq(Seq(JsString("30"))))
        val df     = submitter.loadDataFrame(ds)
        val result = submitter.applyStep(df, castStep(Map("age" -> "integer")))
        result.schema("age").dataType.typeName shouldBe "integer"
        result.collect().head.getAs[Int]("age") shouldBe 30
      }
    }

    "op is select (not yet supported on Spark path)" should {
      "throw IllegalArgumentException with a descriptive message" in {
        val ds = staticDs(Seq("x" -> "string"), Seq(Seq(JsString("y"))))
        val df = submitter.loadDataFrame(ds)
        val ex = intercept[IllegalArgumentException](submitter.applyStep(df, selectStep(Vector("x"))))
        ex.getMessage should include ("not yet supported on the Spark execution path")
      }
    }
  }

  "collectRows" should {
    "return one map per row with all field names" in {
      val ds = staticDs(
        Seq("name" -> "string", "age" -> "integer"),
        Seq(Seq(JsString("Alice"), JsNumber(30)))
      )
      val df   = submitter.loadDataFrame(ds)
      val rows = submitter.collectRows(df)
      rows should have size 1
      rows.head("name") shouldBe "Alice"
      rows.head("age")  shouldBe 30
    }
  }

  // ── Persistence tests: updateLastRun is called on terminal states ────────────

  "submit" when {

    var embeddedPostgres: EmbeddedPostgres              = null
    var db: JdbcBackend.Database                        = null
    var pipelineRepoForSubmit: PipelineRepository       = null
    var pipelineRunRepoForSubmit: PipelineRunRepository = null
    var dsRepoForSubmit: DataSourceRepository           = null

    def startDb(): Unit = {
      embeddedPostgres = EmbeddedPostgres.start()
      Flyway.configure()
        .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
        .locations("classpath:db/migration")
        .load()
        .migrate()
      db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
      val dtRepo = new DataTypeRepository(db)
      dsRepoForSubmit          = new DataSourceRepository(db)
      pipelineRepoForSubmit    = new PipelineRepository(db, dtRepo, dsRepoForSubmit)
      pipelineRunRepoForSubmit = new PipelineRunRepository(db)
    }

    def stopDb(): Unit = { db.close(); embeddedPostgres.close() }

    def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

    def seedPipeline(dsId: String): String = {
      import PostgresProfile.api._
      val ownerId = "00000000-0000-0000-0000-000000000001"
      val dtId    = UUID.randomUUID().toString
      val pid     = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources
                 (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($dsId, 'ds', 'static', '{"columns":[{"name":"x","type":"string"}],"rows":[["a"]]}', $ownerId::uuid, now(), now())""",
        sqlu"""INSERT INTO data_types
                 (id, name, fields, version, owner_id, created_at, updated_at)
                 VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines
                 (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
                 VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
      )))
      pid
    }

    def makePipeline(pid: String, dsId: String): Pipeline =
      Pipeline(
        id                 = PipelineId(pid),
        name               = "pipe",
        sourceDataSourceId = DataSourceId(dsId),
        outputDataTypeId   = DataTypeId("dt"),
        lastRunStatus      = None,
        lastRunAt          = None,
        createdAt          = Instant.now(),
        updatedAt          = Instant.now(),
        ownerId            = UserId("00000000-0000-0000-0000-000000000001")
      )

    "the Spark job succeeds" should {
      "call updateLastRun with 'succeeded' and persist a succeeded run record" in {
        startDb()
        try {
          val dsId = UUID.randomUUID().toString
          val pid  = seedPipeline(dsId)
          val submitterWithRepo = new SparkJobSubmitter("local[*]", dsRepoForSubmit, pipelineRepoForSubmit, pipelineRunRepoForSubmit)
          val ds  = staticDs(Seq("x" -> "string"), Seq(Seq(JsString("a"))), Some(dsId))
          val pip = makePipeline(pid, dsId)
          val cache = new PipelineRunCache()
          await(submitterWithRepo.submit(pip, ds, Seq.empty, cache))
          // Give the Spark future a moment to run
          Thread.sleep(3000)
          val found = await(pipelineRepoForSubmit.findByIdInternal(PipelineId(pid)))
          found.get.lastRunStatus shouldBe Some(RunStatus.Succeeded)
          // Verify run record was persisted
          val runs = await(pipelineRunRepoForSubmit.listByPipeline(PipelineId(pid), AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))))
          runs should have size 1
          runs.head.status   shouldBe RunStatus.Succeeded
          runs.head.rowCount shouldBe Some(1)
          runs.head.errorLog shouldBe None
          submitterWithRepo.spark.stop()
        } finally stopDb()
      }
    }

    "the Spark job fails" should {
      "call updateLastRun with 'failed' and persist a failed run record with errorLog" in {
        startDb()
        try {
          val dsId = UUID.randomUUID().toString
          val pid  = seedPipeline(dsId)
          val submitterWithRepo = new SparkJobSubmitter("local[*]", dsRepoForSubmit, pipelineRepoForSubmit, pipelineRunRepoForSubmit)
          // A filter step that references a nonexistent column will fail at Spark analysis.
          val ds  = staticDs(Seq("x" -> "string"), Seq(Seq(JsString("a"))), Some(dsId))
          val badStep = FilterStep(
            id         = PipelineStepId("s1"),
            pipelineId = PipelineId(pid),
            position   = 0,
            config     = FilterConfig("AND", Vector(FilterCondition("nonexistent_column", ">", Some("0")))),
            createdAt  = Instant.now(),
            updatedAt  = Instant.now()
          )
          val pip   = makePipeline(pid, dsId)
          val cache = new PipelineRunCache()
          await(submitterWithRepo.submit(pip, ds, Seq(badStep), cache))
          Thread.sleep(3000)
          val found = await(pipelineRepoForSubmit.findByIdInternal(PipelineId(pid)))
          found.get.lastRunStatus shouldBe Some(RunStatus.Failed)
          // Verify run record was persisted with error
          val runs = await(pipelineRunRepoForSubmit.listByPipeline(PipelineId(pid), AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))))
          runs should have size 1
          runs.head.status   shouldBe RunStatus.Failed
          runs.head.errorLog shouldBe defined
          runs.head.rowCount shouldBe None
          submitterWithRepo.spark.stop()
        } finally stopDb()
      }
    }
  }

  override def afterAll(): Unit = {
    submitter.spark.stop()
    super.afterAll()
  }
}
