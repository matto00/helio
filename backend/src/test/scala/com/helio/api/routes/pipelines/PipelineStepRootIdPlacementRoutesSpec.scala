package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
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

/** HEL-1345: `POST /pipelines/:id/steps` with `rootId` places the new step where the request
  * says (a `position` index into THAT root's trunk, else that root's trunk tail) instead of
  * head-splicing every time. Every assertion reads the persisted tree back through
  * `GET /pipelines/:id/steps`, never only the 201. */
class PipelineStepRootIdPlacementRoutesSpec
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
  private var outputRepo: OutputRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(typedSystem.executionContext)
    outputRepo     = new OutputRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)(typedSystem.executionContext)
    stepRepo       = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val owner = "00000000-0000-0000-0000-000000000001"
  private val dummyUser = AuthenticatedUser(UserId(owner))

  private def routes: Route = {
    implicit val ec: ExecutionContext = typedSystem.executionContext
    new PipelineStepRoutes(new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo), dummyUser).routes
  }

  /** A pipeline whose root 0 has `id == pipeline id`. */
  private def seedPipeline(): String = {
    import PostgresProfile.api._
    val pid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', $owner, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'p', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  /** A second root (position 1) on `pid`; returns its id. */
  private def seedSecondRoot(pid: String): String = {
    import PostgresProfile.api._
    val rid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds2', 'rest_api', '{}', $owner, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rid, $pid, $dsId, 1)"""
    )))
    rid
  }

  /** A parentless root-level step on root `rootId`, at sibling `position`. */
  private def seedRootLevel(pid: String, rootId: String, position: Int = 0): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, $pid, $position, 'cast', '{"casts":{}}', true, now(), now(), NULL, $rootId)"""
    ))
    id
  }

  private def seedChild(pid: String, parent: String, position: Int = 0): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
             VALUES ($id, $pid, $position, 'cast', '{"casts":{}}', true, now(), now(), $parent)"""
    ))
    id
  }

  /** Trunk A -> B -> C on root 0 (root id == pid). */
  private def seedTrunk3(pid: String): (String, String, String) = {
    val a = seedRootLevel(pid, pid)
    val b = seedChild(pid, a)
    val c = seedChild(pid, b)
    (a, b, c)
  }

  private def castReq(extra: (String, JsValue)*): JsObject =
    JsObject(Map("type" -> JsString("cast"), "config" -> JsObject("casts" -> JsObject())) ++ extra)

  private def body: JsObject = JsonParser(responseAs[String]).asJsObject

  private def reparented(o: JsObject): Vector[String] =
    o.fields("reparentedStepIds").asInstanceOf[JsArray].elements.map(_.convertTo[String])

  private def optStr(o: JsObject, k: String): Option[String] = o.fields.get(k) match {
    case Some(JsString(s)) => Some(s)
    case _                 => None
  }

  /** The persisted tree as `GET /pipelines/:id/steps` reports it: id -> (parentStepId, rootId). */
  private def tree(pid: String): Map[String, (Option[String], Option[String])] =
    Get(s"/pipelines/$pid/steps") ~> routes ~> check {
      status shouldBe StatusCodes.OK
      JsonParser(responseAs[String]).asInstanceOf[JsArray].elements.map { e =>
        val o = e.asJsObject
        o.fields("id").convertTo[String] -> ((optStr(o, "parentStepId"), optStr(o, "rootId")))
      }.toMap
    }

  /** Step ids in the order `GET /pipelines/:id/steps` returns them (execution order). */
  private def getOrder(pid: String): Vector[String] =
    Get(s"/pipelines/$pid/steps") ~> routes ~> check {
      JsonParser(responseAs[String]).asInstanceOf[JsArray].elements.map(_.asJsObject.fields("id").convertTo[String])
    }

  /** POST and return (status, created id if 201, reparentedStepIds if 201). */
  private def create(pid: String, extra: (String, JsValue)*): (StatusCode, String, Vector[String]) =
    Post(s"/pipelines/$pid/steps", castReq(extra: _*)) ~> routes ~> check {
      if (status == StatusCodes.Created) { val o = body; (status, o.fields("id").convertTo[String], reparented(o)) }
      else (status, "", Vector.empty)
    }

  "POST /pipelines/:id/steps with rootId on a single-root trunk A->B->C" should {

    "append at the trunk tail when no position is given" in {
      val pid = seedPipeline(); val (a, b, c) = seedTrunk3(pid)
      val (st, n, moved) = create(pid, "rootId" -> JsString(pid))
      st shouldBe StatusCodes.Created
      moved shouldBe empty
      val t = tree(pid)
      t(n) shouldBe ((Some(c), None))
      t(a) shouldBe ((None, Some(pid)))
      t(b) shouldBe ((Some(a), None))
      t(c) shouldBe ((Some(b), None))
    }

    "splice after trunk(position - 1) for position 2" in {
      val pid = seedPipeline(); val (a, b, c) = seedTrunk3(pid)
      val (st, n, moved) = create(pid, "rootId" -> JsString(pid), "position" -> JsNumber(2))
      st shouldBe StatusCodes.Created
      moved shouldBe Vector(c)
      val t = tree(pid)
      t(n) shouldBe ((Some(b), None))
      t(c) shouldBe ((Some(n), None))
      t(a) shouldBe ((None, Some(pid)))
      t(b) shouldBe ((Some(a), None))
    }

    "become the new head for position 0 (and only then)" in {
      val pid = seedPipeline(); val (a, b, c) = seedTrunk3(pid)
      val (st, n, moved) = create(pid, "rootId" -> JsString(pid), "position" -> JsNumber(0))
      st shouldBe StatusCodes.Created
      moved shouldBe Vector(a)
      val t = tree(pid)
      t(n) shouldBe ((None, Some(pid)))
      t(a) shouldBe ((Some(n), None))
      t(b) shouldBe ((Some(a), None))
      t(c) shouldBe ((Some(b), None))
    }

    "accept position == trunk length as an append" in {
      val pid = seedPipeline(); val (_, _, c) = seedTrunk3(pid)
      val (st, n, moved) = create(pid, "rootId" -> JsString(pid), "position" -> JsNumber(3))
      st shouldBe StatusCodes.Created
      moved shouldBe empty
      tree(pid)(n) shouldBe ((Some(c), None))
    }

    "422 for position 4 and position -1, persisting nothing" in {
      val pid = seedPipeline(); val (a, b, c) = seedTrunk3(pid)
      val before = tree(pid)
      for (bad <- Seq(4, -1)) {
        Post(s"/pipelines/$pid/steps", castReq("rootId" -> JsString(pid), "position" -> JsNumber(bad))) ~> routes ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[String] should include("trunk length")
        }
      }
      tree(pid) shouldBe before
      before.keySet shouldBe Set(a, b, c)
    }
  }

  "POST /pipelines/:id/steps with rootId on an empty root" should {
    "create a root-level step with no position and with position 0, and 422 for position 1" in {
      val pid = seedPipeline()
      val (st1, n1, m1) = create(pid, "rootId" -> JsString(pid))
      st1 shouldBe StatusCodes.Created
      m1 shouldBe empty
      tree(pid)(n1) shouldBe ((None, Some(pid)))

      val pid2 = seedPipeline()
      val (st2, n2, m2) = create(pid2, "rootId" -> JsString(pid2), "position" -> JsNumber(0))
      st2 shouldBe StatusCodes.Created
      m2 shouldBe empty
      tree(pid2)(n2) shouldBe ((None, Some(pid2)))

      val pid3 = seedPipeline()
      Post(s"/pipelines/$pid3/steps", castReq("rootId" -> JsString(pid3), "position" -> JsNumber(1))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      tree(pid3) shouldBe empty
    }
  }

  "POST /pipelines/:id/steps with rootId on a multi-root pipeline" should {

    "append to THAT root's tail and leave the other root untouched" in {
      val pid = seedPipeline()
      val r1a = seedRootLevel(pid, pid); val r1b = seedChild(pid, r1a)
      val r2  = seedSecondRoot(pid)
      val x   = seedRootLevel(pid, r2); val y = seedChild(pid, x)
      val (st, n, moved) = create(pid, "rootId" -> JsString(r2))
      st shouldBe StatusCodes.Created
      moved shouldBe empty
      val t = tree(pid)
      t(n) shouldBe ((Some(y), None))
      t(x) shouldBe ((None, Some(r2)))
      t(y) shouldBe ((Some(x), None))
      t(r1a) shouldBe ((None, Some(pid)))
      t(r1b) shouldBe ((Some(r1a), None))
    }

    "honour position 1 on that root's trunk and leave the other root untouched" in {
      val pid = seedPipeline()
      val r1a = seedRootLevel(pid, pid); val r1b = seedChild(pid, r1a)
      val r2  = seedSecondRoot(pid)
      val x   = seedRootLevel(pid, r2); val y = seedChild(pid, x)
      val (st, n, moved) = create(pid, "rootId" -> JsString(r2), "position" -> JsNumber(1))
      st shouldBe StatusCodes.Created
      moved shouldBe Vector(y)
      val t = tree(pid)
      t(n) shouldBe ((Some(x), None))
      t(y) shouldBe ((Some(n), None))
      t(x) shouldBe ((None, Some(r2)))
      t(r1a) shouldBe ((None, Some(pid)))
      t(r1b) shouldBe ((Some(r1a), None))
    }
  }

  "POST /pipelines/:id/steps with rootId on a root whose only root-level step has position 1" should {
    "append after it rather than becoming a new head" in {
      val pid  = seedPipeline()
      val tail = seedRootLevel(pid, pid, position = 1)
      val (st, n, moved) = create(pid, "rootId" -> JsString(pid))
      st shouldBe StatusCodes.Created
      moved shouldBe empty
      val t = tree(pid)
      t(n) shouldBe ((Some(tail), None))
      t(tail) shouldBe ((None, Some(pid)))
    }
  }

  "POST /pipelines/:id/steps lane pre-check with rootId" should {
    "validate the lane reference against THAT root's trunk-last step, not the first root's" in {
      val pid = seedPipeline()
      val r1a = seedRootLevel(pid, pid); val r1b = seedChild(pid, r1a)
      val r2  = seedSecondRoot(pid)
      val x   = seedRootLevel(pid, r2); val y = seedChild(pid, x)
      // Precondition (so DB row order cannot make this vacuous): the whole-pipeline trunk the old
      // pre-check read resolves to R1's chain, so Y is NOT in the old prospective ancestor set.
      val steps = getOrder(pid)
      steps.indexOf(r1a) should be < steps.indexOf(x)
      val trunk = stepRepo.trunkOf(await(stepRepo.listByPipelineInternal(PipelineId(pid))))
      trunk.map(_.id.value) shouldBe Vector(r1a, r1b)

      val req = JsObject(
        "type" -> JsString("union"),
        "rootId" -> JsString(r2),
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(y)),
          "mode"           -> JsString("byPosition")
        )
      )
      // Y is the ancestor of the prospective parent (R2's trunk-last IS Y) -> cycle -> 400.
      Post(s"/pipelines/$pid/steps", req) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("cycle")
      }
      tree(pid).keySet shouldBe Set(r1a, r1b, x, y)
    }
  }
}
