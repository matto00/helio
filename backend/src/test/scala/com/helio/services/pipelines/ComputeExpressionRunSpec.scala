package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.ComputeConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1403: compute expressions through the REAL run path (`PipelineRunService.submit` against
 *  an embedded Postgres, persisted `node_snapshots` rows asserted) -- unary minus (task 1.2) and
 *  the "warned compute still runs" scenario (task 3.2). */
class ComputeExpressionRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var stepRepo: PipelineStepRepository         = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository             = _
  private var service: PipelineRunService              = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo           = new PipelineStepRepository(ctx)
    nodeSnapshotRepo   = new NodeSnapshotRepository(ctx)
    outputRepo         = new OutputRepository(ctx)
    service = new PipelineRunService(
      new PipelineRepository(ctx, dataSourceRepo), stepRepo, dataSourceRepo, new PipelineRunRepository(ctx),
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  /** Dataset source: `x` numeric (4.5, 7, null), `price` TEXT ("3.5", "9.2", null). */
  private def seedSource(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val raw  = """{"columns":[{"name":"x","type":"double"},{"name":"price","type":"string"}],"rows":[[4.5,"3.5"],[7.0,"9.2"],[null,null]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'unary-src', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, raw)
    )))
    dsId
  }

  private def seedPipeline(dsId: String): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  /** Chains one compute step per (column, expression) onto the trunk, materializes the last node
   *  with an Output, runs for real, and returns the persisted `node_snapshots` rows. */
  private def runComputes(computes: (String, String)*): Vector[JsObject] = {
    val pid = seedPipeline(seedSource())
    var parent: Option[PipelineStepId] = None
    computes.foreach { case (col, expr) =>
      parent = Some(await(stepRepo.insertInternal(pid, "compute", ComputeConfig(col, expr, None), enabled = true, parent, explicitRootId = None)).id)
    }
    await(outputRepo.insertInternal(pid, parent, dummyUser.id, "out", OutputKind.Table, explicitRootId = None))
    await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
    await(nodeSnapshotRepo.listRows(pid.value, parent.map(_.value), explicitRootId = None))
  }

  private def numbers(rows: Vector[JsObject], col: String): Vector[Option[Double]] =
    rows.map(_.fields(col) match { case JsNumber(n) => Some(n.toDouble); case JsNull => None; case o => fail(s"unexpected $o") })

  "a compute step through a real pipeline run" should {

    "persist unary-minus results in node_snapshots (mod(-7, 3), -$x, 2 - -3)" in {
      val rows = runComputes("m" -> "mod(-7, 3)", "neg" -> "-$x", "d" -> "2 - -3")
      rows should have size 3
      numbers(rows, "m") shouldBe Vector(Some(2.0), Some(2.0), Some(2.0))
      numbers(rows, "d") shouldBe Vector(Some(5.0), Some(5.0), Some(5.0))
      numbers(rows, "neg").flatten.sorted shouldBe Vector(-7.0, -4.5)
      numbers(rows, "neg").count(_.isEmpty) shouldBe 1 // the null-x row stays null
    }

    "run (not reject) a numeric function over a text column and null the computed value (warned compute still runs)" in {
      val rows = runComputes("f" -> "floor($price)")
      rows should have size 3
      rows.foreach(_.fields("f") shouldBe JsNull)
    }
  }
}
