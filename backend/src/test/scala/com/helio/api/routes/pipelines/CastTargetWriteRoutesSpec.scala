package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import com.helio.api.JsonProtocols
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.domain.steps.CastConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.{PipelineService, RunConfigGate}
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

/** HEL-1436: an unsupported cast target is rejected (422) on the step-create route and on the
 *  single-call pipeline create, persisting nothing; a STORED legacy-target cast still lists, analyzes
 *  (input type passed through, no validationError) and is not gated. */
class CastTargetWriteRoutesSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineService: PipelineService   = _
  private var stepRepo: PipelineStepRepository   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    stepRepo           = new PipelineStepRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo,
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

  private def castStep(target: String): JsObject =
    JsObject("clientId" -> JsString("cst"), "type" -> JsString("cast"),
      "config" -> JsObject("casts" -> JsObject("doc" -> JsString(target))))

  private def createBody(sourceId: String, name: String, steps: JsObject*): JsObject =
    JsObject("name" -> JsString(name), "roots" -> JsArray(JsObject("sourceId" -> JsString(sourceId))), "steps" -> JsArray(steps.toVector))

  private def pipelineNames(owner: AuthenticatedUser): Vector[String] = {
    var names = Vector.empty[String]
    Get("/pipelines") ~> routesFor(owner) ~> check {
      names = responseAs[JsArray].elements.map(_.asJsObject.fields("name").convertTo[String])
    }
    names
  }

  private def emptyPipeline(owner: AuthenticatedUser, src: String, name: String): PipelineId = {
    var pid = PipelineId("")
    Post("/pipelines", createBody(src, name)) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
    }
    pid
  }

  "unsupported cast targets (HEL-1436)" should {

    "RED: single-call create rejects binary-ref with 422 naming it and the supported list, storing nothing" in {
      val owner = newUser(); val src = newSource(owner)
      Post("/pipelines", createBody(src, "bad-target", castStep("binary-ref"))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[String]
        msg should include("binary-ref")
        msg should include("timestamp")
      }
      pipelineNames(owner) shouldBe empty
    }

    "RED: step-create route rejects string-body with 422 and stores no step" in {
      val owner = newUser(); val src = newSource(owner)
      val pid   = emptyPipeline(owner, src, "step-route")
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("cast"),
        "config" -> JsObject("casts" -> JsObject("doc" -> JsString("string-body"))))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include("string-body")
      }
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        responseAs[JsArray].elements shouldBe empty
      }
    }

    "GUARD: single-call create accepts float and timestamp targets" in {
      val owner = newUser(); val src = newSource(owner)
      for (t <- Seq("float", "timestamp"))
        Post("/pipelines", createBody(src, s"ok-$t", castStep(t))) ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.Created
        }
    }

    "GUARD: a stored legacy binary-ref cast lists, analyzes with no validationError, and is not gated (projection: CastStepSpec)" in {
      val owner = newUser(); val src = newSource(owner)
      val pid   = emptyPipeline(owner, src, "legacy-cast")
      val step  = await(stepRepo.insertInternal(pid, "cast", CastConfig(Map("doc" -> "binary-ref")), explicitRootId = None))
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsArray].elements should have size 1
      }
      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val s = responseAs[JsObject].fields("steps").asInstanceOf[JsArray].elements.head.asJsObject
        s.fields.get("validationError").filter(_ != JsNull) shouldBe None
      }
      val stored = await(stepRepo.listByPipelineInternal(pid))
      RunConfigGate.stepConfigReasons(stored) shouldBe empty
      step should not be null
    }
  }
}
