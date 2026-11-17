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

/** HEL-1638 task 2.6: `POST /api/pipelines` analyses a DISABLED step as transparent (as analyze and the run do) when it
 *  checks an Output's `fieldMapping` columns. Red before the fix: `createTransactional` built its `NodeStepInput`s without
 *  `enabled`, so a disabled `select` still dropped the column and the Output was rejected. */
class DisabledStepOutputColumnRoutesSpec
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
    val dsConfig = """{"columns":[{"name":"doc","type":"string"},{"name":"other","type":"string"}],"rows":[["a","x"],["b","y"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, inferred_schema)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now(),
                     '[{"name":"doc","type":"string"},{"name":"other","type":"string"}]'::jsonb)""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  private def routesFor(owner: AuthenticatedUser): Route =
    concat(new PipelineRoutes(pipelineService, owner).routes, new PipelineStepRoutes(pipelineService, owner).routes)

  private def body(sourceId: String, name: String, enabled: Boolean): JsObject =
    JsObject(
      "name"  -> JsString(name),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(sourceId))),
      "steps" -> JsArray(JsObject(
        "clientId" -> JsString("sel"), "type" -> JsString("select"), "enabled" -> JsBoolean(enabled),
        "config" -> JsObject("fields" -> JsArray(JsString("other")))
      )),
      "outputs" -> JsArray(JsObject(
        "nodeStepClientId" -> JsString("sel"), "kind" -> JsString("chart"), "name" -> JsString("Out"),
        "config" -> JsObject("chartType" -> JsString("bar"), "fieldMapping" -> JsObject("xAxis" -> JsString("doc"), "yAxis" -> JsString("other")))
      ))
    )

  "an Output mapping a column a step would drop (HEL-1638)" should {
    "be accepted when that step is disabled (transparent)" in {
      val owner = newUser(); val src = newSource(owner)
      Post("/pipelines", body(src, "disabled-select", enabled = false)) ~> routesFor(owner) ~> check {
        withClue(responseAs[String])(status shouldBe StatusCodes.Created)
      }
    }
    "GUARD: be rejected with the column message when the step is enabled" in {
      val owner = newUser(); val src = newSource(owner)
      Post("/pipelines", body(src, "enabled-select", enabled = true)) ~> routesFor(owner) ~> check {
        status should not be StatusCodes.Created
        responseAs[String] should include("doc")
      }
    }
  }
}
