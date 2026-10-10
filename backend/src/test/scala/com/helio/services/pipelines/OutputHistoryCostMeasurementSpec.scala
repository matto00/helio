package com.helio.services.pipelines

import com.helio.domain.history.OutputSummaryReducer
import com.helio.domain.model._
import com.helio.domain.steps.AssertConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.lang.reflect.{InvocationHandler, InvocationTargetException, Method, Proxy}
import java.nio.file.Paths
import java.sql.{Connection, PreparedStatement, Statement}
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1271 per-run cost measurement (NOT a gate: it asserts only that history adds work, never a
 *  threshold -- timings are single-machine and flaky as assertions). Runs one real pipeline over a
 *  ~1000-row node with a metric and a chart Output, with and without the history repository, and
 *  prints JDBC statement / batch counts, wall time and reducer CPU time (median of 7). */
class OutputHistoryCostMeasurementSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val statements = new AtomicInteger(0)
  private val batches    = new AtomicInteger(0)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _

  private val user = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def counting[T](target: T, iface: Class[T]): T =
    Proxy.newProxyInstance(iface.getClassLoader, Array[Class[_]](iface), new InvocationHandler {
      override def invoke(proxy: Any, m: Method, args: Array[AnyRef]): AnyRef = {
        val name = m.getName
        if (name == "executeBatch" || name == "executeLargeBatch") batches.incrementAndGet()
        else if (name.startsWith("execute")) statements.incrementAndGet()
        val result =
          try m.invoke(target, Option(args).getOrElse(Array.empty): _*)
          catch { case e: InvocationTargetException => throw e.getCause }
        result match {
          case ps: PreparedStatement if name == "prepareStatement" => counting[PreparedStatement](ps, classOf[PreparedStatement])
          case st: Statement if name == "createStatement"          => counting[Statement](st, classOf[Statement])
          case c: Connection if name == "getConnection"            => counting[Connection](c, classOf[Connection])
          case other                                                => other
        }
      }
    }.asInstanceOf[InvocationHandler]).asInstanceOf[T]

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    val ds = counting[DataSource](embeddedPostgres.getPostgresDatabase, classOf[DataSource])
    db  = JdbcBackend.Database.forDataSource(ds, Some(10))
    ctx = new DbContext(db, db)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private def median(xs: Seq[Long]): Long = xs.sorted.apply(xs.size / 2)

  private def seedFixture(stepRepo: PipelineStepRepository, outputRepo: OutputRepository): PipelineId = {
    import PostgresProfile.api._
    val ownerId = user.id.value
    val dsId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    val rows    = (1 to 1000).map(i => s"""["day$i","${i * 3}","note $i"]""").mkString("[", ",", "]")
    val payload = s"""{"columns":[{"name":"label","type":"string"},{"name":"amount","type":"string"},{"name":"note","type":"string"}],"rows":$rows}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step = await(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty), enabled = true, None, explicitRootId = None))
    val metric = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}}""".parseJson.asJsObject
    val chart  = """{"chartType":"line","fieldMapping":{"xAxis":"label","yAxis":"amount"}}""".parseJson.asJsObject
    await(outputRepo.insertInternal(pipelineId, Some(step.id), user.id, "metric", OutputKind.Metric, metric, explicitRootId = None))
    await(outputRepo.insertInternal(pipelineId, Some(step.id), user.id, "chart", OutputKind.Chart, chart, explicitRootId = None))
    pipelineId
  }

  "per-run history cost on a ~1000-row node (metric + chart Output)" should {
    "be measured with and without the history repository" in {
      val dataSourceRepo = new DataSourceRepository(ctx)
      val stepRepo       = new PipelineStepRepository(ctx)
      val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
      val runRepo        = new PipelineRunRepository(ctx)
      val outputRepo     = new OutputRepository(ctx)
      val snapshots      = new NodeSnapshotRepository(ctx)
      val pid            = seedFixture(stepRepo, outputRepo)

      def service(withHistory: Boolean) = new PipelineRunService(
        pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null,
        new LocalFileSystem(Paths.get("/")), outputRepo = outputRepo, nodeSnapshotRepo = snapshots,
        outputHistoryRepo = if (withHistory) new OutputHistoryRepository(ctx) else null
      )

      def measure(withHistory: Boolean): (Long, Long, Long) = {
        val svc = service(withHistory)
        await(svc.submit(pid, isDry = false, user)) // warm-up, discarded
        val samples = (1 to 7).map { _ =>
          statements.set(0); batches.set(0)
          val t0 = System.nanoTime()
          await(svc.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
          ((System.nanoTime() - t0) / 1000000, statements.get().toLong, batches.get().toLong)
        }
        (median(samples.map(_._1)), median(samples.map(_._2)), median(samples.map(_._3)))
      }

      val (msOff, stmtOff, batchOff) = measure(withHistory = false)
      val (msOn, stmtOn, batchOn)    = measure(withHistory = true)

      val nodeRows = await(snapshots.listRows(pid.value, None, explicitRootId = Some(pid.value))) ++
        await(stepRepo.listByPipelineInternal(pid)).headOption.map(s => await(snapshots.listRows(pid.value, Some(s.id.value), explicitRootId = None))).getOrElse(Vector.empty)
      val chartCfg = """{"chartType":"line","fieldMapping":{"xAxis":"label","yAxis":"amount"}}""".parseJson.asJsObject
      val metricCfg = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}}""".parseJson.asJsObject
      val rows = nodeRows.take(1000)
      def cpuMicros(): Long = {
        val t0 = System.nanoTime()
        OutputSummaryReducer.summarize(rows, OutputKind.Metric, metricCfg)
        OutputSummaryReducer.summarize(rows, OutputKind.Chart, chartCfg)
        (System.nanoTime() - t0) / 1000
      }
      (1 to 20).foreach(_ => cpuMicros()) // JIT warm-up
      val reducerUs = median((1 to 7).map(_ => cpuMicros()))

      // scalastyle:off println
      println(
        s"""[HEL-1271 cost] rows=${rows.size} outputs=2 (metric+chart), median of 7 runs
           |[HEL-1271 cost] without history: wall=${msOff}ms statements=$stmtOff batches=$batchOff
           |[HEL-1271 cost] with history:    wall=${msOn}ms statements=$stmtOn batches=$batchOn
           |[HEL-1271 cost] delta: wall=${msOn - msOff}ms statements=+${stmtOn - stmtOff} batches=+${batchOn - batchOff}; reducer cpu (both Outputs)=${reducerUs}us""".stripMargin
      )
      stmtOn should be > stmtOff
    }
  }
}
