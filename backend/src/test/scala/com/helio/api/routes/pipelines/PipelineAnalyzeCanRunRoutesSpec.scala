package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.api.{JsonProtocols, PipelineAnalyzeResponse}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.domain.{AggregateConfig, AggregateField, Aggregation}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.JsonSchemaValidation
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
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
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1266 seam test (design.md D5). The real `GET /pipelines/:id/analyze` response for a pipeline
 *  with one misconfigured enabled step is validated against the response schema and compared with
 *  `src/test/resources/analyze/step-config-invalid-cost-verdict.json`, the same file the
 *  frontend's `PipelineDetailFooter.stepConfigInvalid.test.tsx` renders. Drift on either side
 *  turns one of the two tests red. */
class PipelineAnalyzeCanRunRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc                                    = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var routes: Route                            = _

  private val owner = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)
    implicit val ec: ExecutionContext = routeEc
    routes = new PipelineRoutes(new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = new OutputRepository(ctx)), owner).routes
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def seedDatasetPipeline(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
             VALUES ($dsId, 'cfg-ds', 'dataset', '{}', ${owner.id.value}::uuid,
                     '[{"name":"region","type":"string"},{"name":"amount","type":"float"}]'::jsonb, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at, last_run_row_count)
             VALUES ($pid, 'cfg-pipeline', now(), now(), 5)""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  private def aggregate(fn: String) =
    AggregateConfig(Vector(AggregateField("region", "string")), Vector(Aggregation("total", fn, "amount")))

  private def addStep(pid: String, fn: String, enabled: Boolean): String =
    await(pipelineStepRepo.insertInternal(PipelineId(pid), "aggregate", aggregate(fn), enabled = enabled, explicitRootId = None)).id.value

  "GET /pipelines/:id/analyze costVerdict with a misconfigured step (HEL-1266)" should {

    "match the shared seam fixture and validate against the response schema" in {
      val pid    = seedDatasetPipeline()
      val stepId = addStep(pid, "bogus_fn", enabled = true)

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String]
        JsonSchemaValidation.validationErrors(
          JsonSchemaValidation.compile("pipelines/pipeline-analyze-response.schema.json"), body
        ) shouldBe empty

        val fixture  = new String(Files.readAllBytes(Paths.get("src/test/resources/analyze/step-config-invalid-cost-verdict.json")))
        val actual   = body.parseJson.asJsObject.fields("costVerdict").compactPrint.replace(stepId, "STEP_ID")
        actual.parseJson shouldBe fixture.parseJson
      }
    }

    "name every enabled misconfigured step, once each, and ignore a disabled one" in {
      val pid       = seedDatasetPipeline()
      val first     = addStep(pid, "bogus_a", enabled = true)
      val second    = addStep(pid, "bogus_b", enabled = true)
      val disabled  = addStep(pid, "bogus_c", enabled = false)

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        val verdict = responseAs[PipelineAnalyzeResponse].costVerdict
        val config  = verdict.reasons.filter(_.code == "step-config-invalid")
        config.flatMap(_.stepId).toSet shouldBe Set(first, second)
        config.map(_.detail).exists(_.contains("bogus_a")) shouldBe true
        config.map(_.detail).exists(_.contains("bogus_b")) shouldBe true
        config.flatMap(_.stepId) should not contain disabled
        verdict.canRun shouldBe false
        verdict.autoRunnable shouldBe false
      }
    }

    "leave canRun true for a clean owner pipeline and for a pipeline whose only misconfigured step is disabled" in {
      val clean = seedDatasetPipeline()
      addStep(clean, "sum", enabled = true)
      val disabledOnly = seedDatasetPipeline()
      addStep(disabledOnly, "bogus_fn", enabled = false)

      Seq(clean, disabledOnly).foreach { pid =>
        Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
          val verdict = responseAs[PipelineAnalyzeResponse].costVerdict
          verdict.reasons.map(_.code) should not contain "step-config-invalid"
          verdict.canRun shouldBe true
        }
      }
    }
  }
}
