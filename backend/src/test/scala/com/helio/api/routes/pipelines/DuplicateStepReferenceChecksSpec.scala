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

/** HEL-1514: `POST /pipeline-steps/:id/duplicate` against the three reference checks create runs and
 *  duplicate does not: lane reference, upsert target, and secondary-source ownership. Each scenario builds the
 *  state in which CREATE rejects the config at the clone's position for the caller, and asserts duplicate
 *  answers the same way. Stored rows that no write surface can produce are seeded by SQL (as HEL-1476 does). */
class DuplicateStepReferenceChecksSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineService: PipelineService   = _

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
    pipelineService = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx)(routeEc), dataSourceRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser): String = {
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

  private def routesFor(owner: AuthenticatedUser): Route =
    concat(new PipelineRoutes(pipelineService, owner).routes, new PipelineStepRoutes(pipelineService, owner).routes)

  private def emptyPipeline(owner: AuthenticatedUser): PipelineId = {
    var pid = PipelineId("")
    val body = JsObject("name" -> JsString(s"p-${UUID.randomUUID()}"),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(newSource(owner)))), "steps" -> JsArray.empty)
    Post("/pipelines", body) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
    }
    pid
  }

  private def grant(pid: PipelineId, grantee: AuthenticatedUser, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                        VALUES ('pipeline', ${pid.value}, ${grantee.id.value}::uuid, $role, now())"""))
  }

  private def rootOf(pid: PipelineId): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = ${pid.value} ORDER BY position LIMIT 1".as[String].head))
  }

  /** SQL-seeded step; `parent` None = root-level on the pipeline's first root. */
  private def seedStep(pid: PipelineId, kind: String, config: String, parent: Option[String], position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    val rootId: Option[String] = if (parent.isEmpty) Some(rootOf(pid)) else None
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, ${pid.value}, $position, $kind, $config::jsonb, true, now(), now(), $parent, $rootId)"""
    ))
    id
  }

  private def laneJoin(laneId: String): String =
    s"""{"secondaryInput":{"kind":"lane","stepId":"$laneId"},"joinKey":"id","joinType":"inner"}"""

  private def sourceJoin(dsId: String): String =
    s"""{"secondaryInput":{"kind":"source","dataSourceId":"$dsId"},"joinKey":"id","joinType":"inner"}"""

  private def stepCountOf(user: AuthenticatedUser, pid: PipelineId): Int = {
    var n = -1
    Get(s"/pipelines/${pid.value}/steps") ~> routesFor(user) ~> check { n = responseAs[JsArray].elements.size }
    n
  }

  "duplicate vs create: lane reference (validateLaneReference)" should {
    "422 for a join whose lane target was deleted after the original was written (create and update say 422)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head  = seedStep(pid, "rename", """{"renames":{}}""", None, 0)
      val lane  = seedStep(pid, "rename", """{"renames":{}}""", Some(head), 1)
      val join  = seedStep(pid, "join", laneJoin(lane), Some(head), 0)
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.Created }
      Delete(s"/pipeline-steps/$lane") ~> routesFor(owner) ~> check { status.isSuccess shouldBe true }
      storedConfigOf(join).toString should include(lane) // deleting the target does not cascade into the referrer
      val before = stepCountOf(owner, pid)
      Patch(s"/pipeline-steps/$join", JsObject("config" -> storedConfigOf(join))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(owner) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
      }
      stepCountOf(owner, pid) shouldBe before
    }

    "400 (cycle) for a join whose lane target became an ancestor via a trunk reorder" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head  = seedStep(pid, "rename", """{"renames":{}}""", None, 0)
      val join  = seedStep(pid, "join", """{"secondaryInput":{"kind":"lane","stepId":"PLACEHOLDER"},"joinKey":"id","joinType":"inner"}""", Some(head), 0)
      val target = seedStep(pid, "rename", """{"renames":{}}""", Some(join), 0)
      setConfig(join, laneJoin(target))
      Put(s"/pipelines/${pid.value}/steps/order", JsObject("stepIds" -> JsArray(JsString(head), JsString(target), JsString(join)))) ~>
        routesFor(owner) ~> check { withClue(responseAs[String]) { status.isSuccess shouldBe true } }
      Patch(s"/pipeline-steps/$join", JsObject("config" -> storedConfigOf(join))) ~> routesFor(owner) ~> check {
        withClue("update must reject the cycle: ") { status shouldBe StatusCodes.BadRequest }
      }
      val before = stepCountOf(owner, pid)
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(owner) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.BadRequest }
      }
      stepCountOf(owner, pid) shouldBe before
    }
  }

  "duplicate vs create: upsert target (upsertOwnershipCheckF, pipeline-owner identity)" should {
    "404 for a stored upsertsource whose existing-source target is not the pipeline owner's (create says 404)" in {
      val owner = newUser(); val other = newUser(); val pid = emptyPipeline(owner)
      val foreign = newSource(other)
      val up = seedStep(pid, "upsertsource",
        s"""{"target":{"kind":"existingSource","dataSourceId":"$foreign"},"mode":"append"}""", None, 0)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("upsertsource"), "config" ->
        JsObject("target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(foreign)), "mode" -> JsString("append")))) ~>
        routesFor(owner) ~> check { status shouldBe StatusCodes.NotFound }
      val before = stepCountOf(owner, pid)
      Post(s"/pipeline-steps/$up/duplicate") ~> routesFor(owner) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
      }
      stepCountOf(owner, pid) shouldBe before
    }
  }

  "duplicate vs create: secondary-source ownership (findByIdOwned, CALLER identity)" should {
    "control: an editor grantee cannot create or update a join referencing the owner's source (404)" in {
      val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
      val srcB = newSource(owner)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("join"), "config" -> sourceJoin(srcB).parseJson)) ~>
        routesFor(editor) ~> check { status shouldBe StatusCodes.NotFound }
      val join = seedStep(pid, "join", sourceJoin(srcB), None, 0)
      Patch(s"/pipeline-steps/$join", JsObject("config" -> storedConfigOf(join))) ~> routesFor(editor) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    val secondaryConfigs: Seq[(String, String => String)] = Seq(
      "join"   -> (ds => sourceJoin(ds)),
      "union"  -> (ds => s"""{"secondaryInput":{"kind":"source","dataSourceId":"$ds"},"mode":"byPosition"}"""),
      "lookup" -> (ds => s"""{"secondaryInput":{"kind":"source","dataSourceId":"$ds"},"sourceKey":"code","lookupKey":"code","columns":["label"]}""")
    )
    secondaryConfigs.foreach { case (kind, cfg) =>
      s"an editor grantee duplicating the owner's source-$kind gets 404 like create/update, and no clone" in {
        val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
        val step = seedStep(pid, kind, cfg(newSource(owner)), None, 0)
        Post(s"/pipeline-steps/$step/duplicate") ~> routesFor(editor) ~> check {
          withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
        }
        stepCountOf(owner, pid) shouldBe 1
      }

      s"GUARD: the pipeline owner still duplicates a $kind on a source they own" in {
        val owner = newUser(); val pid = emptyPipeline(owner)
        val step = seedStep(pid, kind, cfg(newSource(owner)), None, 0)
        Post(s"/pipeline-steps/$step/duplicate") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.Created }
        stepCountOf(owner, pid) shouldBe 2
      }

      s"GUARD: an editor still duplicates a $kind draft with an unset secondary source id" in {
        val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
        val step = seedStep(pid, kind, cfg(""), None, 0)
        Post(s"/pipeline-steps/$step/duplicate") ~> routesFor(editor) ~> check {
          withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
        }
      }
    }

    "GUARD: an editor still duplicates a lane-secondary join (no source ownership applies)" in {
      val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
      val head = seedStep(pid, "rename", """{"renames":{}}""", None, 0)
      val lane = seedStep(pid, "rename", """{"renames":{}}""", Some(head), 1)
      val join = seedStep(pid, "join", laneJoin(lane), Some(head), 0)
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(editor) ~> check { status shouldBe StatusCodes.Created }
    }
  }

  private def storedConfigOf(id: String): JsObject = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT config::text FROM pipeline_steps WHERE id = $id".as[String].head)).parseJson.asJsObject
  }

  private def setConfig(id: String, config: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE pipeline_steps SET config = $config::jsonb WHERE id = $id"))
  }
}
