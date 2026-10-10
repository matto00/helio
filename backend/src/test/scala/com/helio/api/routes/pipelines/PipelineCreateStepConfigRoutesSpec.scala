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
import com.helio.domain.steps.{ComputeConfig, FillNullConfig}
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1402: the single-call `POST /api/pipelines` applies the same strict step-config rejection
 *  (422) as the step routes, for every step kind, atomically. */
class PipelineCreateStepConfigRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var pipelineService: PipelineService     = _
  private var stepRepo: PipelineStepRepository     = _
  private var pipelineRepo: PipelineRepository     = _

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
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

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
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  private def routesFor(owner: AuthenticatedUser): Route =
    concat(new PipelineRoutes(pipelineService, owner).routes, new PipelineStepRoutes(pipelineService, owner).routes)

  private def step(clientId: String, kind: String, config: JsObject): JsObject =
    JsObject("clientId" -> JsString(clientId), "type" -> JsString(kind), "config" -> config)

  private def createBody(sourceId: String, name: String, steps: JsObject*): JsObject =
    JsObject(
      "name"  -> JsString(name),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(sourceId))),
      "steps" -> JsArray(steps.toVector)
    )

  private def pipelineNames(owner: AuthenticatedUser): Vector[String] = {
    var names = Vector.empty[String]
    Get("/pipelines") ~> routesFor(owner) ~> check {
      names = responseAs[JsArray].elements.map(_.asJsObject.fields("name").convertTo[String])
    }
    names
  }

  private val supportedFunctionsMarker = "supported functions"

  "POST /pipelines step-config validation (HEL-1402)" should {

    "reject a compute step calling an unknown function with 422 naming the step, function and supported list, persisting nothing" in {
      val owner = newUser(); val src = newSource(owner)
      val bad   = step("calc", "compute", JsObject("column" -> JsString("c"), "expression" -> JsString("$a + nosuchfn($b)")))
      Post("/pipelines", createBody(src, "bad-compute", bad)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[String]
        msg should include("calc")
        msg should include("nosuchfn")
        msg should include(supportedFunctionsMarker)
      }
      pipelineNames(owner) shouldBe empty
    }

    "reject a cast step whose casts is an array with 422 naming casts" in {
      val owner = newUser(); val src = newSource(owner)
      val bad   = step("cst", "cast", JsObject("casts" -> JsArray(JsObject("column" -> JsString("score"), "to" -> JsString("string")))))
      Post("/pipelines", createBody(src, "bad-cast", bad)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include("casts")
      }
      pipelineNames(owner) shouldBe empty
    }

    "reject an aggregate step with an unsupported fn with 422" in {
      val owner = newUser(); val src = newSource(owner)
      val agg = step("agg", "aggregate", JsObject(
        "groupBy"      -> JsArray(),
        "aggregations" -> JsArray(JsObject("alias" -> JsString("a"), "fn" -> JsString("bogus"), "field" -> JsString("score")))
      ))
      Post("/pipelines", createBody(src, "bad-agg", agg)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should (include("Step 'agg':") and include("bogus"))
      }
      pipelineNames(owner) shouldBe empty
    }

    // HEL-1416: clearly invalid fillnull/window/pivot enum values are rejected on single-call create too.
    "reject an invalid fillnull strategy, window function, lag offset and pivot agg with 422, persisting nothing (HEL-1416)" in {
      val owner = newUser(); val src = newSource(owner)
      val cases = Seq(
        step("fn", "fillnull", JsObject("columns" -> JsArray(JsString("name")), "strategy" -> JsString("average")))       -> "Unsupported fillnull strategy: 'average'",
        step("w1", "window", JsObject("function" -> JsString("ntile"), "outputColumn" -> JsString("o")))                    -> "Unsupported window function: 'ntile'",
        step("w2", "window", JsObject("function" -> JsString("lag"), "field" -> JsString("score"), "offset" -> JsNumber(0), "outputColumn" -> JsString("o"))) -> "requires a positive 'offset'",
        step("pv", "pivot", JsObject("column" -> JsString("name"), "values" -> JsString("score"), "agg" -> JsString("median"))) -> "Unsupported pivot aggregation function: 'median'"
      )
      for ((bad, msg) <- cases)
        Post("/pipelines", createBody(src, "bad-enum", bad)) ~> routesFor(owner) ~> check {
          withClue(msg) { status shouldBe StatusCodes.UnprocessableEntity }
          responseAs[String] should include(msg)
        }
      pipelineNames(owner) shouldBe empty
    }

    "accept incomplete fillnull/window/pivot drafts (HEL-1416)" in {
      val owner = newUser(); val src = newSource(owner)
      val drafts = Seq(
        step("fn", "fillnull", JsObject("columns" -> JsArray(), "strategy" -> JsString("constant"))),
        step("w", "window", JsObject("function" -> JsString("lag"), "outputColumn" -> JsString("prev"))),
        step("pv", "pivot", JsObject("column" -> JsString("name"), "values" -> JsString("score")))
      )
      for ((d, i) <- drafts.zipWithIndex)
        Post("/pipelines", createBody(src, s"draft-$i", d)) ~> routesFor(owner) ~> check { status shouldBe StatusCodes.Created }
    }

    "still list and analyze a legacy stored fillnull step with an unknown strategy, reporting it once (HEL-1416)" in {
      val owner = newUser(); val src = newSource(owner)
      var pid = PipelineId("")
      Post("/pipelines", createBody(src, "legacy-fillnull")) ~> routesFor(owner) ~> check {
        pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
      }
      await(stepRepo.insertInternal(pid, "fillnull", FillNullConfig(Vector("name"), "average", None), explicitRootId = None))
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsArray].elements should have size 1
      }
      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val stepErr = responseAs[JsObject].fields("steps").asInstanceOf[JsArray].elements.head.asJsObject.fields("validationError").convertTo[String]
        stepErr shouldBe "Unsupported fillnull strategy: 'average'. Supported: constant, forwardFill, mean, median, mode"
      }
    }

    "create filter, aggregate (object groupBy), sort and select steps in their documented shapes" in {
      val owner = newUser(); val src = newSource(owner)
      val steps = Seq(
        step("f", "filter", JsObject("combinator" -> JsString("AND"), "conditions" -> JsArray(
          JsObject("field" -> JsString("name"), "operator" -> JsString("="), "value" -> JsString("alice"))))),
        step("a", "aggregate", JsObject(
          "groupBy"      -> JsArray(JsObject("name" -> JsString("name"), "type" -> JsString("string"))),
          "aggregations" -> JsArray(JsObject("alias" -> JsString("avg_score"), "field" -> JsString("score"), "fn" -> JsString("avg"))))),
        step("s", "sort", JsObject("sortBy" -> JsArray(JsObject("field" -> JsString("avg_score"), "direction" -> JsString("desc"))))),
        step("sel", "select", JsObject("fields" -> JsArray(JsString("name"))))
      )
      val chained = steps.zipWithIndex.map { case (s, i) =>
        if (i == 0) s else JsObject(s.fields + ("parentStepId" -> JsString(steps(i - 1).fields("clientId").convertTo[String])))
      }
      Post("/pipelines", createBody(src, "valid-multi", chained: _*)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
      pipelineNames(owner) should contain("valid-multi")
    }

    "accept an empty compute draft" in {
      val owner = newUser(); val src = newSource(owner)
      val draft = step("d", "compute", JsObject("column" -> JsString(""), "expression" -> JsString("")))
      Post("/pipelines", createBody(src, "empty-draft", draft)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "still list and analyze a legacy stored compute step with an unknown function" in {
      val owner = newUser(); val src = newSource(owner)
      var pid = PipelineId("")
      Post("/pipelines", createBody(src, "legacy")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
      }
      await(stepRepo.insertInternal(pid, "compute", ComputeConfig("c", "nosuchfn(1)", None), explicitRootId = None))
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsArray].elements should have size 1
      }
      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("step-config-invalid")
      }
    }
  }
}
