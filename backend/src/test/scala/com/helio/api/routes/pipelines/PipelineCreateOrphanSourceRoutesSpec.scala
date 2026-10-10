package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1469: a single-call `POST /api/pipelines` whose request is rejected (4xx) must leave no data
 *  source behind -- including the inline root source the call would have created. Every case counts
 *  `data_sources` rows by the exact test owner id before and after (a status-only assertion would
 *  prove nothing: the leak is invisible in the response). */
class PipelineCreateOrphanSourceRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var route: Route                       = _
  private var pipelineRepo: PipelineRepository  = _

  private val owner: AuthenticatedUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    implicit val ec: ExecutionContext = routeEc
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val fs             = new LocalFileSystem(newTempDir("pipeline-create-orphan-source-spec"))
    val service = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx)(routeEc), dataSourceRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc),
      sourceService = new SourceService(dataSourceRepo, connector = null),
      dataSourceService = new DataSourceService(dataSourceRepo, fs)
    )(routeEc)
    route = new PipelineRoutes(service, owner).routes
    val id = owner.id.value
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Exact-owner-id row count -- never a name pattern. */
  private def ownedSourceCount(): Int = {
    import PostgresProfile.api._
    val id = owner.id.value
    await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $id::uuid".as[Int])).head
  }

  private def pipelineCount(): Int = {
    import PostgresProfile.api._
    val id = owner.id.value
    await(db.run(sql"SELECT count(*) FROM pipelines WHERE owner_id = $id::uuid".as[Int])).head
  }

  private def inlineRoot(name: String): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`       = Some("dataset"),
      name         = Some(s"$name-${UUID.randomUUID()}"),
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
    )

  private def step(clientId: String, kind: String, config: JsObject, parent: Option[String] = None) =
    CreatePipelineTransactionalStepRequest(clientId, kind, config, parentStepId = parent)

  private val validSelect = step("ok", "select", JsObject("fields" -> JsArray(JsString("amount"))))

  /** Posts `req`, asserts the expected status, and that neither a data source nor a pipeline was left behind. */
  private def expectRejectedWithNothingLeft(req: CreatePipelineRequest, expected: StatusCode)(
      extra: String => Unit = _ => ()
  ): Unit = {
    val sourcesBefore   = ownedSourceCount()
    val pipelinesBefore = pipelineCount()
    Post("/pipelines", req) ~> route ~> check {
      status shouldBe expected
      extra(responseAs[String])
    }
    ownedSourceCount() shouldBe sourcesBefore
    pipelineCount() shouldBe pipelinesBefore
  }

  "POST /pipelines with an inline root (HEL-1469)" should {

    "leave no data source when a step config is refused (422)" in {
      val bad = step("calc", "compute", JsObject("column" -> JsString("c"), "expression" -> JsString("$a + nosuchfn($b)")))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("bad-config")), steps = Vector(bad)), StatusCodes.UnprocessableEntity)(
        msg => msg should include("calc")
      )
    }

    "leave no data source when a step type is unknown (400)" in {
      val bad = step("s", "nosuchkind", JsObject.empty)
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("bad-type")), steps = Vector(bad)), StatusCodes.BadRequest)(
        msg => msg should include("nosuchkind")
      )
    }

    "leave no data source when an Output config carries a disallowed key (400)" in {
      val out = CreatePipelineTransactionalOutputRequest(None, "table", "o", config = Some(JsObject("notAKey" -> JsNumber(1))))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("bad-output")), outputs = Vector(out)), StatusCodes.BadRequest)()
    }

    "leave no data source when an Output fieldMapping names a column the inline source lacks (400, schema-dependent)" in {
      val out = CreatePipelineTransactionalOutputRequest(None, "metric", "o", config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("does_not_exist")))))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("bad-mapping")), outputs = Vector(out)), StatusCodes.BadRequest)(
        msg => msg should include("does_not_exist")
      )
    }

    "leave no inline source of root 0 when root 1 names an unknown sourceId, simple path (404)" in {
      val roots = Vector(inlineRoot("multi-simple"), CreatePipelineRootRequest(sourceId = Some(UUID.randomUUID().toString)))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", roots), StatusCodes.NotFound)()
    }

    "leave no inline source of root 0 when root 1 names an unknown sourceId, transactional path (404)" in {
      val roots = Vector(inlineRoot("multi-tx").copy(clientId = Some("r0")), CreatePipelineRootRequest(sourceId = Some(UUID.randomUUID().toString)))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", roots, steps = Vector(validSelect.copy(rootClientId = Some("r0")))), StatusCodes.NotFound)()
    }

    "keep today's 422 and message for a lane reference absent from the request, and leave no data source" in {
      val lane = step("u", "union", JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("ghost")), "mode" -> JsString("byPosition")))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("lane-missing")), steps = Vector(lane)), StatusCodes.UnprocessableEntity)(
        msg => msg should include("Lane reference 'ghost' does not exist in this request.")
      )
    }

    "keep today's 400 and message for a lane self-reference, and leave no data source" in {
      val lane = step("u", "union", JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("u")), "mode" -> JsString("byPosition")))
      expectRejectedWithNothingLeft(CreatePipelineRequest("p", Vector(inlineRoot("lane-self")), steps = Vector(lane)), StatusCodes.BadRequest)(
        msg => msg should include("Lane reference 'u' cannot reference the step itself.")
      )
    }

    "still create the pipeline AND its inline source when the request is valid" in {
      val sourcesBefore = ownedSourceCount()
      Post("/pipelines", CreatePipelineRequest("p-ok", Vector(inlineRoot("happy")), steps = Vector(validSelect))) ~> route ~> check {
        status shouldBe StatusCodes.Created
      }
      ownedSourceCount() shouldBe sourcesBefore + 1
    }
  }
}
