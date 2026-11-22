package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain._
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{PipelineRunService, TriggerSource}
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.JsonSchemaValidation
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.{Files, Paths}
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1815: the real `GET /pipelines/:id/run-history` route is held to
 *  `schemas/pipelines/pipeline-run-record.schema.json` for one run per trigger source, including the omitted-Option
 *  shapes the route actually writes (a succeeded run with no `errorLog`, an unfinished run with no `completedAt` or
 *  `rowCount`). The body is also held to `shared-test-fixtures/pipeline-run/run-history-response.json`, which the web
 *  client's contract test reads. Regenerate with
 *  `HEL1815_WRITE_FIXTURE=1 sbt "testOnly *PipelineRunHistorySchemaSpec"`. */
class PipelineRunHistorySchemaSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var pipelineRepo: PipelineRepository     = _
  private var stepRepo: PipelineStepRepository     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var runRepo: PipelineRunRepository       = _
  private var outputRepo: OutputRepository         = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    runRepo        = new PipelineRunRepository(ctx)(routeEc)
    outputRepo     = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  /** Every value `TriggerSource` writes. HAND-WRITTEN: a new `TriggerSource` value must be added here (and to the
   *  schema enum); this list is what the seeded runs and the enum assertion are built from. */
  private val AllSources: Seq[String] =
    Seq(TriggerSource.Manual, TriggerSource.Scheduled, TriggerSource.External, TriggerSource.AutoRun)

  private val base = Instant.parse("2026-01-01T00:00:00Z")

  /** One pipeline with one run per source. The shapes are deliberately the sparse ones the route writes: manual =
   *  succeeded with no errorLog, scheduled = failed with an errorLog and no rowCount, external = queued (no completedAt,
   *  rowCount or errorLog), auto-run = succeeded with a rowCount and no errorLog. Nothing is filled in to pass. */
  private def seedPipelineWithRuns(): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'hist-ds', 'dataset', '{"columns":[],"rows":[]}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'hist-pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    def terminal(id: PipelineRunId, status: String, at: Instant, rows: Option[Int], err: Option[String]): Unit =
      await(runRepo.updateRunTerminalInternal(id, status, at, rows, err, Some(PipelineRunService.EmptyTruncationJson)))
    AllSources.zipWithIndex.foreach { case (source, i) =>
      val runId   = PipelineRunId(UUID.randomUUID().toString)
      val started = base.plusSeconds(i.toLong * 60)
      await(runRepo.insertRunInternal(runId, pipelineId, started, source))
      source match {
        case TriggerSource.Manual    => terminal(runId, "succeeded", started.plusSeconds(5), Some(5), None)
        case TriggerSource.Scheduled => terminal(runId, "failed", started.plusSeconds(5), None, Some("boom"))
        case TriggerSource.AutoRun   => terminal(runId, "succeeded", started.plusSeconds(5), Some(3), None)
        case _                       => () // external stays queued
      }
    }
    pipelineId
  }

  private def routes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), null, new LocalFileSystem(Paths.get("/")), null, null,
      new RestApiConnectorDriver(None),
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )
    new PipelineRunHistoryRoutes(service, dummyUser).routes
  }

  private def historyBody(pid: PipelineId): Vector[JsObject] = {
    var out = Vector.empty[JsObject]
    Get(s"/pipelines/${pid.value}/run-history") ~> routes ~> check {
      status shouldBe StatusCodes.OK
      out = responseAs[String].parseJson.convertTo[Vector[JsObject]]
    }
    out
  }

  private val schema    = JsonSchemaValidation.compile("pipelines/pipeline-run-record.schema.json")
  private val fixtureDir = Paths.get("../shared-test-fixtures/pipeline-run")

  /** Run ids, timestamps and the pipeline id to stable placeholders (ids keyed by trigger source). */
  private def normalise(records: Vector[JsObject]): JsValue =
    JsArray(records.map { r =>
      val src = r.fields("triggerSource").convertTo[String]
      def stamp(k: String): Option[(String, JsValue)] = r.fields.get(k).collect { case JsString(_) => k -> JsString("{{TIMESTAMP}}") }
      val swapped = r.fields ++ Map("id" -> JsString(s"{{RUN_$src}}"), "pipelineId" -> JsString("{{PIPELINE_1}}")) ++
        stamp("startedAt") ++ stamp("completedAt")
      JsObject(swapped)
    })

  "GET /pipelines/:id/run-history" should {

    "write one record per trigger source, and the schema enum lists exactly those sources" in {
      val records = historyBody(seedPipelineWithRuns())
      records.map(_.fields("triggerSource").convertTo[String]).toSet shouldBe AllSources.toSet
      val schemaJson = Files.readString(JsonSchemaValidation.schemaFile("pipelines/pipeline-run-record.schema.json").toPath).parseJson.asJsObject
      val enum = schemaJson.fields("properties").asJsObject.fields("triggerSource").asJsObject.fields("enum").convertTo[Vector[String]]
      enum.toSet shouldBe AllSources.toSet
    }

    "omit the unset Option fields on the shapes it seeds (the sparse wire the schema must admit)" in {
      val bySource = historyBody(seedPipelineWithRuns()).map(r => r.fields("triggerSource").convertTo[String] -> r).toMap
      bySource(TriggerSource.Manual).fields.keySet should not contain "errorLog"
      bySource(TriggerSource.External).fields.keySet should not contain atLeastOneOf("completedAt", "rowCount", "errorLog")
      bySource(TriggerSource.Scheduled).fields should contain key "errorLog"
    }

    "validate every record against pipeline-run-record.schema.json, naming the failing location" in {
      val records = historyBody(seedPipelineWithRuns())
      val failures = records.map { r =>
        r.fields("triggerSource").convertTo[String] -> JsonSchemaValidation.validationErrors(schema, r.compactPrint)
      }.filter(_._2.nonEmpty).toMap
      withClue(s"schema violations by trigger source (networknt messages start with the JSON path): $failures\n") {
        failures shouldBe empty
      }
    }

    "report a violation with its JSON path (the location the red assertions rely on)" in {
      val bad = historyBody(seedPipelineWithRuns()).head
      val errors = JsonSchemaValidation.validationErrors(schema, JsObject(bad.fields + ("triggerSource" -> JsString("not-a-source"))).compactPrint)
      errors.filter(_.startsWith("$.triggerSource")) should have size 1
    }

    "match the shared fixture the web client reads" in {
      val produced = normalise(historyBody(seedPipelineWithRuns()))
      val path     = fixtureDir.resolve("run-history-response.json")
      if (sys.env.contains("HEL1815_WRITE_FIXTURE")) { Files.createDirectories(fixtureDir); Files.writeString(path, produced.prettyPrint + "\n") }
      produced shouldBe Files.readString(path).parseJson
    }
  }
}
