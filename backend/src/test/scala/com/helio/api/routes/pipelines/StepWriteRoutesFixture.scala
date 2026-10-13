package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import com.helio.api.JsonProtocols
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Shared embedded-Postgres route fixture for the HEL-1515 step-write specs: a real `PipelineService` behind
 *  `PipelineRoutes`/`PipelineStepRoutes`, throwaway users, and SQL-seeded steps (so a fixture holds regardless of
 *  what the write surface accepts). */
trait StepWriteRoutesFixture extends HelioRouteTest with JsonProtocols with BeforeAndAfterAll {
  this: AnyWordSpec with Matchers =>

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected def routeEc: ExecutionContext                  = typedSystem.executionContext

  protected var embeddedPostgres: EmbeddedPostgres = _
  protected var db: JdbcBackend.Database           = _
  protected var pipelineService: PipelineService   = _
  protected var stepRepo: PipelineStepRepository   = _
  protected var dsRepo: DataSourceRepository       = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)(routeEc)
    dsRepo           = new DataSourceRepository(ctx)(routeEc)
    val pipelineRepo = new PipelineRepository(ctx, dsRepo)(routeEc)
    stepRepo         = new PipelineStepRepository(ctx)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dsRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  protected def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  protected def newSource(owner: AuthenticatedUser): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"doc","type":"string"}],"rows":[["a"],["b"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  protected def routesFor(owner: AuthenticatedUser): Route =
    concat(new PipelineRoutes(pipelineService, owner).routes, new PipelineStepRoutes(pipelineService, owner).routes)

  protected def emptyPipeline(owner: AuthenticatedUser): PipelineId = {
    var pid = PipelineId("")
    val body = JsObject("name" -> JsString(s"p-${UUID.randomUUID()}"),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(newSource(owner)))), "steps" -> JsArray.empty)
    Post("/pipelines", body) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
    }
    pid
  }

  protected def rootOf(pid: PipelineId): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = ${pid.value} ORDER BY position LIMIT 1".as[String].head))
  }

  /** SQL-seeded step; `parent` None = root-level on the pipeline's first root. */
  protected def seedStep(pid: PipelineId, kind: String, config: String, parent: Option[String], position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    val rootId: Option[String] = if (parent.isEmpty) Some(rootOf(pid)) else None
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, ${pid.value}, $position, $kind, $config::jsonb, true, now(), now(), $parent, $rootId)"""
    ))
    id
  }

  protected val rename = """{"renames":{}}"""

  protected def laneJoin(laneId: String): String =
    s"""{"secondaryInput":{"kind":"lane","stepId":"$laneId"},"joinKey":"id","joinType":"inner"}"""

  /** A join with no second input chosen yet (the picker's own draft) -- legal to store, lane-free. */
  protected val draftJoin =
    """{"secondaryInput":{"kind":"source","dataSourceId":""},"joinKey":"id","joinType":"inner"}"""

  protected def stepCountOf(user: AuthenticatedUser, pid: PipelineId): Int = {
    var n = -1
    Get(s"/pipelines/${pid.value}/steps") ~> routesFor(user) ~> check { n = responseAs[JsArray].elements.size }
    n
  }

  protected def storedConfigOf(id: String): JsObject = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT config::text FROM pipeline_steps WHERE id = $id".as[String].head)).parseJson.asJsObject
  }

  protected def createJoin(owner: AuthenticatedUser, pid: PipelineId, lane: String, extra: (String, JsValue)*)(assertion: => Any): Unit =
    Post(s"/pipelines/${pid.value}/steps",
      JsObject(Map("type" -> JsString("join"), "config" -> laneJoin(lane).parseJson) ++ extra)) ~> routesFor(owner) ~> check { assertion }

  protected def patchConfig(owner: AuthenticatedUser, step: String, config: String)(assertion: => Any): Unit =
    Patch(s"/pipeline-steps/$step", JsObject("config" -> config.parseJson)) ~> routesFor(owner) ~> check { assertion }

  protected def grant(pid: PipelineId, grantee: AuthenticatedUser, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                        VALUES ('pipeline', ${pid.value}, ${grantee.id.value}::uuid, $role, now())"""))
  }
}
