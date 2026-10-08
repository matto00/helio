package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.protocols.pipelines.{OutputProtocol, OutputResponse}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.history.{PayloadHistoryConfig, PayloadTierLimit}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.auth.{UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.pipelines.NodePayloadHistoryRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.NodePayloadFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Duration
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1331: `historyPayloadsAvailable` on every Output REST response, derived from the PIPELINE
 *  OWNER's tier and resolved through the production `ApiRoutes` wiring (given only a `dbContext`, like
 *  `Main`), so a missed wiring in `ApiRoutes` fails here instead of silently failing the editor closed. */
class OutputHistoryPayloadsAvailableSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with NodePayloadFixtures {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var freeId, betaId, ownerTierId, freeEditorId: String = _
  private var tokens: Map[String, String]                          = Map.empty // token -> user id
  private var api: Route                                           = _

  private val stubSessions: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
      Future.successful(tokens.get(t).map(id => AuthenticatedUser(UserId(id))))
  }
  private val stubFs: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                     = Future.successful(())
    def exists(path: String): Future[Boolean]                  = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    startHarness()
    freeId = seedUser("free"); betaId = seedUser("beta"); ownerTierId = seedUser("owner"); freeEditorId = seedUser("free")
    tokens = Seq(freeId, betaId, ownerTierId, freeEditorId).map(id => s"tok-$id" -> id).toMap
    api = buildApi(PayloadHistoryConfig.fromEnv())
  }

  private def buildApi(config: PayloadHistoryConfig): Route =
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, stubFs, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(harnessEc), stubSessions, new UserPreferenceRepository(db)(harnessEc), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(harnessEc),
      dbContext = ctx,
      payloadHistoryConfig = config
    ).routes
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def as(userId: String)(req: HttpRequest) =
    req.addHeader(Cookie(SessionCookies.Name -> s"tok-$userId")).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))

  private def json(body: String) = HttpEntity(ContentTypes.`application/json`, body)

  private def flag(js: JsObject): Option[JsValue] = js.fields.get("historyPayloadsAvailable")

  /** All 5 REST sites for `viewer` against one Output of `pipelineId`; every response must carry `expected`. */
  private def assertAllSites(viewer: String, pipelineId: String, outputId: String, expected: Boolean, listAllOwnsIt: Boolean = true): Unit = {
    val want = Some(JsBoolean(expected))
    as(viewer)(Get(s"/api/pipelines/$pipelineId/outputs")) ~> api ~> check {
      status shouldBe StatusCodes.OK
      val items = responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
      items should not be empty
      items.map(flag).distinct shouldBe Vector(want)
    }
    as(viewer)(Get(s"/api/outputs/$outputId")) ~> api ~> check {
      status shouldBe StatusCodes.OK
      flag(responseAs[String].parseJson.asJsObject) shouldBe want
    }
    // `GET /api/outputs` lists only Outputs the caller owns, so a grantee has none on this pipeline.
    as(viewer)(Get("/api/outputs?limit=100")) ~> api ~> check {
      status shouldBe StatusCodes.OK
      val items = responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
      val mine  = items.filter(_.fields("pipelineId") == JsString(pipelineId)).map(flag).distinct
      mine shouldBe (if (listAllOwnsIt) Vector(want) else Vector.empty)
    }
  }

  "NodePayloadHistoryRepository.payloadsAvailableFor" should {
    "map free/beta/owner pipeline owners and an unknown id (and an empty set)" in {
      val repo = new NodePayloadHistoryRepository(ctx)(harnessEc)
      val (pf, _) = seedPipelineWithOutput(freeId)
      val (pb, _) = seedPipelineWithOutput(betaId)
      val (po, _) = seedPipelineWithOutput(ownerTierId)
      val unknown = UUID.randomUUID().toString
      awaitDb(repo.payloadsAvailableFor(Set(pf, pb, po, unknown), PayloadHistoryConfig.fromEnv())) shouldBe
        Map(pf -> false, pb -> true, po -> true, unknown -> false)
      awaitDb(repo.payloadsAvailableFor(Set.empty, PayloadHistoryConfig.fromEnv())) shouldBe Map.empty
    }

    "map an unknown tier string to false instead of throwing" in {
      val repo = new NodePayloadHistoryRepository(ctx)(harnessEc)
      val weird = seedUser("free")
      val (p, _) = seedPipelineWithOutput(weird)
      awaitDb(db.run(sqlu"ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check"))
      awaitDb(db.run(sqlu"UPDATE users SET tier = 'mystery' WHERE id = $weird::uuid"))
      awaitDb(repo.payloadsAvailableFor(Set(p), PayloadHistoryConfig.fromEnv())) shouldBe Map(p -> false)
    }
  }

  "the Output REST routes, through production ApiRoutes wiring," should {
    "report false for a free-tier pipeline owner at every site" in {
      val fx = seedPayloadPipeline(freeId)
      assertAllSites(freeId, fx.pid.value, fx.optedOutput, expected = false)
    }

    "report true for a beta-tier and an owner-tier pipeline owner at every site" in {
      val b = seedPayloadPipeline(betaId)
      assertAllSites(betaId, b.pid.value, b.optedOutput, expected = true)
      val o = seedPayloadPipeline(ownerTierId)
      assertAllSites(ownerTierId, o.pid.value, o.optedOutput, expected = true)
    }

    "report the owner's tier (not the caller's) to a free editor grantee, on read, create and PATCH" in {
      val fx = seedPayloadPipeline(betaId)
      grantPipeline(fx.pid.value, freeEditorId, "editor")
      assertAllSites(freeEditorId, fx.pid.value, fx.optedOutput, expected = true, listAllOwnsIt = false)

      // POST (create) site: the editor's own Output on the beta-owned pipeline.
      val created = as(freeEditorId)(Post(s"/api/pipelines/${fx.pid.value}/outputs", json(
        s"""{"nodeStepId":"${fx.stepId.value}","kind":"table","name":"editor out"}"""))) ~> api ~> check {
        status shouldBe StatusCodes.Created
        val js = responseAs[String].parseJson.asJsObject
        flag(js) shouldBe Some(JsBoolean(true))
        js.fields("id").convertTo[String]
      }
      // PATCH is Output-owner-only: patch the editor's own Output; the client-sent config key is ignored.
      as(freeEditorId)(Patch(s"/api/outputs/$created", json("""{"config":{"historyPayloadsAvailable":false}}"""))) ~> api ~> check {
        status shouldBe StatusCodes.OK
        flag(responseAs[String].parseJson.asJsObject) shouldBe Some(JsBoolean(true))
      }
      // PATCHing the pipeline owner's Output is 404 for the grantee, by design.
      as(freeEditorId)(Patch(s"/api/outputs/${fx.optedOutput}", json("""{"name":"x"}"""))) ~> api ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "report true on PATCH by a beta owner and false on a free owner's PATCH" in {
      val b = seedPayloadPipeline(betaId)
      as(betaId)(Patch(s"/api/outputs/${b.plainOutput}", json("""{"config":{"historyPayloads":true}}"""))) ~> api ~> check {
        status shouldBe StatusCodes.OK
        flag(responseAs[String].parseJson.asJsObject) shouldBe Some(JsBoolean(true))
      }
      val f = seedPayloadPipeline(freeId)
      as(freeId)(Patch(s"/api/outputs/${f.plainOutput}", json("""{"name":"renamed"}"""))) ~> api ~> check {
        status shouldBe StatusCodes.OK
        flag(responseAs[String].parseJson.asJsObject) shouldBe Some(JsBoolean(false))
      }
    }

    "report true on POST by a beta owner and false by a free owner" in {
      Seq(betaId -> true, freeId -> false).foreach { case (uid, want) =>
        val fx = seedPayloadPipeline(uid)
        as(uid)(Post(s"/api/pipelines/${fx.pid.value}/outputs", json(
          s"""{"nodeStepId":"${fx.stepId.value}","kind":"table","name":"created"}"""))) ~> api ~> check {
          status shouldBe StatusCodes.Created
          flag(responseAs[String].parseJson.asJsObject) shouldBe Some(JsBoolean(want))
        }
      }
    }
  }

  // HEL-1372: `historyPayloadLimits` mirrors the running server's PayloadHistoryConfig.
  private def limits(js: JsObject): Option[JsValue] = js.fields.get("historyPayloadLimits")

  private val defaultLimitsJson: JsValue =
    """{"maxRows":1000,"maxBytes":1048576,"tiers":{"free":{"maxRuns":0,"maxAgeDays":0},"beta":{"maxRuns":10,"maxAgeDays":7},"owner":{"maxRuns":30,"maxAgeDays":30}}}""".parseJson

  private val overriddenConfig: PayloadHistoryConfig =
    PayloadHistoryConfig.Defaults.copy(
      maxRows = 500,
      beta = PayloadTierLimit(5, Duration.ofDays(3))
    )

  private val overriddenLimitsJson: JsValue =
    """{"maxRows":500,"maxBytes":1048576,"tiers":{"free":{"maxRuns":0,"maxAgeDays":0},"beta":{"maxRuns":5,"maxAgeDays":3},"owner":{"maxRuns":30,"maxAgeDays":30}}}""".parseJson

  /** Every REST site (list, get, GET /api/outputs, POST, PATCH) must carry `want` for the owner. */
  private def assertLimitsAtAllSites(route: Route, viewer: String, fx: PayloadFx, want: JsValue): Unit = {
    as(viewer)(Get(s"/api/pipelines/${fx.pid.value}/outputs")) ~> route ~> check {
      status shouldBe StatusCodes.OK
      val items = responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
      items should not be empty
      items.map(limits).distinct shouldBe Vector(Some(want))
    }
    as(viewer)(Get(s"/api/outputs/${fx.optedOutput}")) ~> route ~> check {
      limits(responseAs[String].parseJson.asJsObject) shouldBe Some(want)
    }
    as(viewer)(Get("/api/outputs?limit=100")) ~> route ~> check {
      val items = responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
      val mine  = items.filter(_.fields("pipelineId") == JsString(fx.pid.value)).map(limits).distinct
      mine shouldBe Vector(Some(want))
    }
    as(viewer)(Post(s"/api/pipelines/${fx.pid.value}/outputs", json(
      s"""{"nodeStepId":"${fx.stepId.value}","kind":"table","name":"limits out"}"""))) ~> route ~> check {
      status shouldBe StatusCodes.Created
      limits(responseAs[String].parseJson.asJsObject) shouldBe Some(want)
    }
    as(viewer)(Patch(s"/api/outputs/${fx.plainOutput}", json("""{"name":"renamed-limits"}"""))) ~> route ~> check {
      status shouldBe StatusCodes.OK
      limits(responseAs[String].parseJson.asJsObject) shouldBe Some(want)
    }
  }

  "historyPayloadLimits on Output responses" should {
    "report the default limits at every site, for free and beta owners alike" in {
      assertLimitsAtAllSites(api, betaId, seedPayloadPipeline(betaId), defaultLimitsJson)
      assertLimitsAtAllSites(api, freeId, seedPayloadPipeline(freeId), defaultLimitsJson)
    }

    "report an overridden config at every site" in {
      val overridden = buildApi(overriddenConfig)
      assertLimitsAtAllSites(overridden, betaId, seedPayloadPipeline(betaId), overriddenLimitsJson)
    }

    "not let a client-sent config.historyPayloadLimits affect the top-level field" in {
      val fx = seedPayloadPipeline(betaId)
      as(betaId)(Patch(s"/api/outputs/${fx.plainOutput}", json(
        """{"config":{"historyPayloadLimits":{"maxRows":1,"maxBytes":1,"tiers":{}}}}"""))) ~> api ~> check {
        val js = responseAs[String].parseJson.asJsObject
        limits(js) shouldBe Some(defaultLimitsJson)
      }
    }

    "be omitted when the availability pair is not wired" in {
      val resp = OutputResponse(
        "id", "pid", None, "owner", "n", "table", JsObject.empty, Vector.empty, "t", "t"
      )
      val proto = new OutputProtocol {}
      resp.toJson(proto.outputResponseFormat).asJsObject.fields.keySet should not contain "historyPayloadLimits"
    }
  }
}
