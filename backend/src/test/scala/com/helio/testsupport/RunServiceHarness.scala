package com.helio.testsupport

import com.helio.domain._
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputHistoryRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.PipelineRunService
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, Suite}
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.io.{BufferedWriter, FileWriter}
import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1660: a real `PipelineRunService` over embedded Postgres, a real CSV file on disk and real snapshot/history repositories, so a
 *  spec exercises the whole run path (`PipelineRunService` -> `PipelineRunExecutor` -> `PipelineRunSucceededWrites`) and not just the
 *  engine. Subclasses may swap the engine and the snapshot repository (to sample the heap) before the service is built. */
trait RunServiceHarness extends BeforeAndAfterAll with TempDirectorySupport { self: Suite =>

  protected implicit val harnessEc: ExecutionContext = ExecutionContext.global

  protected val ownerId: String           = "00000000-0000-0000-0000-000000000001"
  protected val owner: AuthenticatedUser  = AuthenticatedUser(UserId(ownerId))

  protected var embeddedPostgres: EmbeddedPostgres     = _
  protected var db: JdbcBackend.Database               = _
  protected var pipelineRepo: PipelineRepository       = _
  protected var stepRepo: PipelineStepRepository       = _
  protected var dataSourceRepo: DataSourceRepository   = _
  protected var pipelineRunRepo: PipelineRunRepository = _
  protected var outputRepo: OutputRepository           = _
  protected var service: PipelineRunService            = _

  protected def engineOver(fileSystem: LocalFileSystem): InProcessPipelineEngine = new InProcessPipelineEngine(fileSystem)
  protected def snapshotRepoOver(ctx: DbContext): NodeSnapshotRepository         = new NodeSnapshotRepository(ctx)

  override def beforeAll(): Unit = {
    super.beforeAll()
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db, db)
    dataSourceRepo  = new DataSourceRepository(ctx)
    stepRepo        = new PipelineStepRepository(ctx)
    pipelineRepo    = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRunRepo = new PipelineRunRepository(ctx)
    outputRepo      = new OutputRepository(ctx)
    val fileSystem  = new LocalFileSystem(Paths.get("/"))
    val backend     = new InProcessExecutionBackend(engineOver(fileSystem), stepRepo)
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, new PipelineRunCache(), registry = null, fileSystem,
      executionBackend = backend, outputRepo = outputRepo, nodeSnapshotRepo = snapshotRepoOver(ctx), outputHistoryRepo = new OutputHistoryRepository(ctx)
    )
  }

  override def afterAll(): Unit = {
    try { db.close(); embeddedPostgres.close() } finally super.afterAll()
  }

  protected def awaitDb[A](f: Future[A]): A = Await.result(f, 600.seconds)

  /** Writes `rows` x `columns` of CSV (header `a`, `b`, ...; cell text from `cell`) to a temp file and registers it as a csv source. */
  protected def seedCsvSource(rows: Int, columns: Int, cell: (Int, Int) => String, header: Option[Vector[String]] = None): String = {
    import PostgresProfile.api._
    val file = newTempFile("helio-run-limits-", ".csv")
    val out  = new BufferedWriter(new FileWriter(file.toFile))
    try {
      out.write(header.getOrElse(Vector.tabulate(columns)(c => ('a' + c).toChar.toString)).mkString(",")); out.newLine()
      var r = 0
      while (r < rows) { out.write((0 until columns).map(c => csvCell(cell(r, c))).mkString(",")); out.newLine(); r += 1 }
    } finally out.close()
    val dsId = UUID.randomUUID().toString
    val path = file.toAbsolutePath.toString
    awaitDb(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'csv-src', 'csv', ${s"""{"path":"$path"}"""}::jsonb, $ownerId, now(), now())"""
    ))
    dsId
  }

  /** A `dataset` source holding `rows` (positional, in `columns` order), seeded straight into `dataset_rows`: the only source kind
   *  whose cells may hold newlines, which the splittext and extractheadings shapes need. */
  protected def seedDatasetSource(columns: Vector[String], rows: Vector[Vector[String]]): String = {
    import PostgresProfile.api._
    import spray.json._
    val dsId    = UUID.randomUUID().toString
    val payload = JsObject(
      "columns" -> JsArray(columns.map(n => JsObject("name" -> JsString(n), "type" -> JsString("string")))),
      "rows"    -> JsArray(rows.map(r => JsArray(r.map(JsString(_)))))
    )
    awaitDb(db.run(slick.dbio.DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'dataset-src', 'dataset', '{}', $ownerId, now(), now())""",
      DatasetRowsTestSupport.seedActions(dsId, payload)
    )))
    dsId
  }

  private def csvCell(text: String): String =
    if (text.exists(ch => ch == ',' || ch == '"' || ch == '\n')) "\"" + text.replace("\"", "\"\"") + "\"" else text

  protected def seedPipeline(sourceDsId: String): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    awaitDb(db.run(slick.dbio.DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'run-limits', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $sourceDsId, 0)"""
    )))
    PipelineId(pid)
  }

  protected def addStep(pid: PipelineId, kind: String, config: Any, parent: Option[PipelineStep] = None): PipelineStep =
    awaitDb(stepRepo.insertInternal(pid, kind, config, enabled = true, parent.map(_.id), explicitRootId = None, actingUserId = ownerId))

  protected def addOutput(pid: PipelineId, step: PipelineStep, name: String): OutputId =
    awaitDb(outputRepo.insertInternal(pid, Some(step.id), UserId(ownerId), name, OutputKind.Table, explicitRootId = None)).id

  protected def nodeSnapshotRows(pid: PipelineId, step: PipelineStep): Int = {
    import PostgresProfile.api._
    awaitDb(db.run(sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pid.value} AND node_step_id = ${step.id.value}".as[Int].head))
  }

  protected def nodeSnapshotCount(pid: PipelineId): Int = {
    import PostgresProfile.api._
    awaitDb(db.run(sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pid.value}".as[Int].head))
  }
}
