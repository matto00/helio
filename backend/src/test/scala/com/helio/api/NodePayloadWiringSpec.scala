package com.helio.api

import org.apache.pekko.http.scaladsl.model.HttpRequest
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.util.SystemClock
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.auth.{UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.pipelines.{OutputHistoryRetentionConfig, OutputHistoryRetentionService}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.NodePayloadFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1276 task 6.9 (C5): the HEL-466 class of defect -- a collaborator built in a spec that Main never
 *  builds. `ApiRoutes` here gets ONLY a `dbContext` (as the production wiring derives everything else
 *  from it), a real opted-in run goes through `POST /api/pipelines/:id/run`, and the stored payload is
 *  read back over the real route. Also: the full route tree (never the public sub-tree alone) refuses
 *  an anonymous or token-only payload request, and the retention service wired exactly as `Main` wires
 *  it purges a downgraded tier's payload. */
class NodePayloadWiringSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with NodePayloadFixtures {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _
  private val token           = "wiring-token-owner"
  private var api: Route      = _

  private val stubSessions: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (t == token) Some(AuthenticatedUser(UserId(ownerId))) else None)
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
    ownerId = seedUser("beta")
    // Only `dbContext`: no history repo, no payload repo, no payload config -- exactly what must be derived.
    api = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, stubFs, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(harnessEc), stubSessions, new UserPreferenceRepository(db)(harnessEc), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(harnessEc),
      dbContext = ctx
    ).routes
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def authed(req: HttpRequest) =
    req.addHeader(Cookie(SessionCookies.Name -> token)).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))

  "ApiRoutes built from dbContext alone" should {

    "store a payload on a real opted-in run via the API and serve it on the rows route" in {
      val fx = seedPayloadPipeline(ownerId)
      authed(Post(s"/api/pipelines/${fx.pid.value}/run")) ~> api ~> check { status shouldBe StatusCodes.OK }
      payloadCount(fx.pid.value) shouldBe 1

      val pointId = authed(Get(s"/api/outputs/${fx.optedOutput}/history")) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val p = responseAs[String].parseJson.asJsObject.fields("points").convertTo[Vector[JsObject]].head
        p.fields("hasPayload") shouldBe JsBoolean(true)
        p.fields("id").convertTo[String]
      }
      authed(Get(s"/api/outputs/${fx.optedOutput}/history/$pointId/rows")) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String].parseJson.asJsObject
        body.fields("rowCount") shouldBe JsNumber(3)
        body.fields("rows").convertTo[Vector[JsObject]].map(_.fields("label")) shouldBe Vector("a", "b", "c").map(JsString(_))
      }

      // Public payload path through the FULL tree: 401 anonymous and token-only, no row data.
      val dashId  = UUID.randomUUID().toString
      val panelId = UUID.randomUUID().toString
      val shareToken = "wiring-share-token-" + UUID.randomUUID()
      val tokenHash  = TokenHashing.sha256Hex(shareToken)
      awaitDb(db.run(DBIO.seq(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)""",
        // A REAL, valid share token (only its SHA-256 hex is stored, V101): the token-only request below
        // would be authorized if any public route handled the payload path.
        sqlu"""INSERT INTO share_tokens (dashboard_id, user_id, token_hash) VALUES ($dashId, ${ownerId}::uuid, $tokenHash)""",
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', ${fx.optedOutput}, ${ownerId}::uuid)"""
      )))
      def assertPayloadPathRefused(): Unit =
        Seq("", s"?token=$shareToken").foreach { q =>
          Get(s"/api/dashboards/$dashId/panels/$panelId/history/$pointId/rows$q") ~> api ~> check {
            status shouldBe StatusCodes.Unauthorized
            responseAs[String] should not include "\"rows\""
            responseAs[String] should not include "\"label\""
          }
        }

      // Phase A (no public grant): the share token is the ONLY way in. Anonymous /history is denied
      // (AclDirective: 404 for no access), while the same token gets 200 with history points -- so the 401s
      // below cannot be explained by a broken token. (With a public grant this control would be vacuous:
      // the directive consults the token only when grant resolution denies.)
      Get(s"/api/dashboards/$dashId/panels/$panelId/history") ~> api ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/api/dashboards/$dashId/panels/$panelId/history?token=$shareToken") ~> api ~> check {
        status shouldBe StatusCodes.OK
        val points = responseAs[String].parseJson.asJsObject.fields("points").convertTo[Vector[JsValue]]
        points should not be empty
      }
      assertPayloadPathRefused()

      // Phase B: even once the dashboard is public, payloads stay unexposed.
      awaitDb(db.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashId, NULL, 'viewer', now())"""
      ))
      assertPayloadPathRefused()
    }
  }

  "the retention service wired as Main wires it" should {
    "purge a downgraded tier's payload on the tick" in {
      val owner = seedUser("owner")
      val fx    = seedPayloadPipeline(owner)
      awaitDb(runService().submit(fx.pid, isDry = false, AuthenticatedUser(UserId(owner)))) shouldBe a[Right[_, _]]
      payloadCount(fx.pid.value) shouldBe 1
      val svc = new OutputHistoryRetentionService(
        new OutputHistoryRepository(ctx), OutputHistoryRetentionConfig.fromEnv(), SystemClock,
        new NodePayloadHistoryRepository(ctx), PayloadHistoryConfig.fromEnv()
      )(harnessEc)
      awaitDb(svc.purgeIfDue(Instant.now())) shouldBe defined
      payloadCount(fx.pid.value) shouldBe 1 // still owner tier: kept
      awaitDb(db.run(sqlu"UPDATE users SET tier = 'free' WHERE id = $owner::uuid"))
      val svc2 = new OutputHistoryRetentionService(
        new OutputHistoryRepository(ctx), OutputHistoryRetentionConfig.fromEnv(), SystemClock,
        new NodePayloadHistoryRepository(ctx), PayloadHistoryConfig.fromEnv()
      )(harnessEc)
      awaitDb(svc2.purgeIfDue(Instant.now())) shouldBe defined
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 1
    }
  }
}
