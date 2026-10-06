package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.model.{AuthenticatedUser, PipelineStep, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.HelioRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-958 seam test, backend half. `shared-test-fixtures/join-step-config.json` holds the exact
 *  config the join editor persists (frontend `JoinConfig.seam.test.tsx` drives the real editor and
 *  asserts its PATCH body equals each case; helio-mcp `joinStepSeam.test.ts` checks the documented
 *  shape). Here the SAME objects must (a) pass strict validation, (b) round-trip through the
 *  companion's wire codec unchanged, and (c) be accepted by the real step routes and read back
 *  identical. A key renamed on either side fails one of the suites. */
class JoinStepConfigSeamSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/join-step-config.json"))).asJsObject
  private val cases: Map[String, JsObject] =
    fixture.fields("cases").asJsObject.fields.map { case (k, v) => k -> v.asJsObject }
  private val sourceId = cases("source").fields("secondaryInput").asJsObject.fields("dataSourceId").convertTo[String]
  private val laneId   = cases("lane").fields("secondaryInput").asJsObject.fields("stepId").convertTo[String]

  private val owner = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var routes: Route                      = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    implicit val ec: ExecutionContext = typedSystem.executionContext
    val ctx            = new DbContext(db, db)(ec)
    val dataSourceRepo = new DataSourceRepository(ctx)(ec)
    val stepRepo       = new PipelineStepRepository(ctx)(ec)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(ec)
    routes = new PipelineStepRoutes(new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = new OutputRepository(ctx)), owner).routes
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  /** A pipeline with one root step (the new join's parent), a sibling-lane step carrying the
   *  fixture's lane id, and a data source carrying the fixture's source id (so both
   *  `secondaryInput` arms resolve). */
  private def seed(): (String, String) = {
    import PostgresProfile.api._
    val pid    = UUID.randomUUID().toString
    val dsId   = UUID.randomUUID().toString
    val rootId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""DELETE FROM pipeline_steps WHERE id = $laneId""",
      sqlu"""DELETE FROM data_sources WHERE id = $sourceId""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($sourceId, 'right', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'p', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id) VALUES ($rootId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id) VALUES ($laneId, $pid, 1, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)"""
    )))
    (pid, rootId)
  }

  private val companion = PipelineStep.Registry("join")

  "the shared join-step-config fixture" should {

    "pass the join step's strict raw-config validation, for every case" in {
      cases.foreach { case (name, cfg) =>
        withClue(s"case $name: ") { companion.validateRawConfig(cfg.compactPrint) shouldBe None }
      }
    }

    "round-trip through readFromWire/writeToWire to the identical JSON, for every case" in {
      cases.foreach { case (name, cfg) =>
        withClue(s"case $name: ") { companion.writeToWire(companion.readFromWire(cfg)) shouldBe cfg }
      }
    }

    "be accepted by the real step route (POST) and read back identical (GET), for every case" in {
      cases.foreach { case (name, cfg) =>
        val (pid, rootId) = seed()
        val body = JsObject("type" -> JsString("join"), "config" -> cfg, "parentStepId" -> JsString(rootId))
        val created = Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
          withClue(s"case $name POST: ") { status shouldBe StatusCodes.Created }
          responseAs[String].parseJson.asJsObject
        }
        created.fields("config") shouldBe cfg
        Get(s"/pipelines/$pid/steps") ~> routes ~> check {
          status shouldBe StatusCodes.OK
          val join = responseAs[String].parseJson.convertTo[Vector[JsValue]]
            .map(_.asJsObject).find(_.fields("type") == JsString("join")).get
          withClue(s"case $name GET: ") { join.fields("config") shouldBe cfg }
        }
      }
    }
  }
}
