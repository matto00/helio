package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.api._
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.HelioRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import spray.json._
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1069: `POST /pipelines/:id/steps` `rejectIfReparents` guard and the create-only
  * `reparentedStepIds` response field (specs/pipeline-step-reparent-reporting). */
class PipelineStepReparentRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var stepRepo: PipelineStepRepository     = _
  private var pipelineRepo: PipelineRepository     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var outputRepo: OutputRepository = _


  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(typedSystem.executionContext)
    outputRepo = new OutputRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)(typedSystem.executionContext)
    stepRepo       = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def routes: Route = {
    implicit val ec: ExecutionContext = typedSystem.executionContext
    new PipelineStepRoutes(new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo), dummyUser).routes
  }

  private def seedPipeline(): String = {
    import PostgresProfile.api._
    val pid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'p', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  /** A parentless root-level step on the pipeline's own root 0 (root_id = pipeline id). */
  private def seedRootStep(pid: String): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, $pid, 0, 'cast', '{"casts":{}}', true, now(), now(), NULL, $pid)"""
    ))
    id
  }

  private def seedChild(pid: String, parent: String, position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
             VALUES ($id, $pid, $position, 'cast', '{"casts":{}}', true, now(), now(), $parent)"""
    ))
    id
  }

  private def parentOf(id: String): Option[String] = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT parent_step_id FROM pipeline_steps WHERE id = $id".as[Option[String]].head))
  }

  private def stepCount(pid: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM pipeline_steps WHERE pipeline_id = $pid".as[Int].head))
  }

  private def castReq(extra: (String, JsValue)*): JsObject =
    JsObject(Map("type" -> JsString("cast"), "config" -> JsObject("casts" -> JsObject())) ++ extra)

  private def body: JsObject = JsonParser(responseAs[String]).asJsObject

  private def reparented(o: JsObject): Vector[String] =
    o.fields("reparentedStepIds").asInstanceOf[JsArray].elements.map(_.convertTo[String])

  "POST /pipelines/:id/steps with rejectIfReparents" should {

    "422 naming the child for a parentStepId anchor that has a child, writing nothing" in {
      val pid    = seedPipeline()
      val anchor = seedRootStep(pid)
      val child  = seedChild(pid, anchor, 0)
      Post(s"/pipelines/$pid/steps", castReq("parentStepId" -> JsString(anchor), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include(child)
      }
      stepCount(pid) shouldBe 2
      parentOf(child) shouldBe Some(anchor)
    }

    // HEL-1345: a `rootId` create no longer head-splices, so "rootId on a non-empty root" is not
    // always a reparent. It reparents (and so trips the guard) only for `position: 0` (new head)
    // or when that root's trunk-last step has children (a tail).
    "422 for a rootId create with position 0 on a root that already has root-level steps, writing nothing" in {
      val pid  = seedPipeline()
      val root = seedRootStep(pid)
      Post(s"/pipelines/$pid/steps", castReq("rootId" -> JsString(pid), "position" -> JsNumber(0), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include(root)
      }
      stepCount(pid) shouldBe 1
      parentOf(root) shouldBe None
    }

    "422 for a no-position rootId append whose trunk-last step has a tail, writing nothing" in {
      val pid   = seedPipeline()
      val root  = seedRootStep(pid)
      val trunk = seedChild(pid, root, 0)
      val tail  = seedChild(pid, trunk, 1)
      Post(s"/pipelines/$pid/steps", castReq("rootId" -> JsString(pid), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include(tail)
      }
      stepCount(pid) shouldBe 3
      parentOf(tail) shouldBe Some(trunk)
    }

    "append a no-position rootId create onto a childless trunk-last step with the flag set, nothing reparented" in {
      val pid   = seedPipeline()
      val root  = seedRootStep(pid)
      val trunk = seedChild(pid, root, 0)
      var newId = ""
      Post(s"/pipelines/$pid/steps", castReq("rootId" -> JsString(pid), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val o = body
        newId = o.fields("id").convertTo[String]
        reparented(o) shouldBe empty
      }
      stepCount(pid) shouldBe 3
      parentOf(newId) shouldBe Some(trunk)
      parentOf(root) shouldBe None
      parentOf(trunk) shouldBe Some(root)
    }

    "422 for a no-anchor add whose trunk-last step has a tail" in {
      val pid  = seedPipeline()
      val root = seedRootStep(pid)
      val trunk = seedChild(pid, root, 0)
      val tail  = seedChild(pid, trunk, 1)
      Post(s"/pipelines/$pid/steps", castReq("rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include(tail)
      }
      stepCount(pid) shouldBe 3
      parentOf(tail) shouldBe Some(trunk)
    }

    "still 422 for attachAsTail=true without parentStepId (the backend splices on that path)" in {
      val pid   = seedPipeline()
      val root  = seedRootStep(pid)
      val trunk = seedChild(pid, root, 0)
      val tail  = seedChild(pid, trunk, 1)
      Post(s"/pipelines/$pid/steps", castReq("attachAsTail" -> JsBoolean(true), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include(tail)
      }
      stepCount(pid) shouldBe 3
    }

    "never rejects attachAsTail=true with parentStepId; reparentedStepIds is empty and nothing moves" in {
      val pid    = seedPipeline()
      val anchor = seedRootStep(pid)
      val child  = seedChild(pid, anchor, 0)
      Post(s"/pipelines/$pid/steps", castReq("parentStepId" -> JsString(anchor), "attachAsTail" -> JsBoolean(true), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        reparented(body) shouldBe empty
      }
      parentOf(child) shouldBe Some(anchor)
      stepCount(pid) shouldBe 3
    }

    "appends to a childless anchor with the flag set, reparentedStepIds empty" in {
      val pid    = seedPipeline()
      val anchor = seedRootStep(pid)
      Post(s"/pipelines/$pid/steps", castReq("parentStepId" -> JsString(anchor), "rejectIfReparents" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        reparented(body) shouldBe empty
      }
    }
  }

  "POST /pipelines/:id/steps without the flag" should {

    "splice as before and report the moved child in reparentedStepIds" in {
      val pid    = seedPipeline()
      val anchor = seedRootStep(pid)
      val child  = seedChild(pid, anchor, 0)
      var newId  = ""
      Post(s"/pipelines/$pid/steps", castReq("parentStepId" -> JsString(anchor))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val o = body
        newId = o.fields("id").convertTo[String]
        reparented(o) shouldBe Vector(child)
      }
      parentOf(child) shouldBe Some(newId)
    }

    "report an empty reparentedStepIds on a plain trunk append" in {
      val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        reparented(body) shouldBe empty
      }
    }
  }

  "reparentedStepIds is create-only" should {
    "be absent from GET list, PATCH and duplicate responses" in {
      val pid  = seedPipeline()
      val root = seedRootStep(pid)
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "reparentedStepIds"
      }
      Patch(s"/pipeline-steps/$root", JsObject("config" -> JsObject("casts" -> JsObject()))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        body.fields should not contain key("reparentedStepIds")
      }
      Post(s"/pipeline-steps/$root/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        body.fields should not contain key("reparentedStepIds")
      }
    }
  }
}
