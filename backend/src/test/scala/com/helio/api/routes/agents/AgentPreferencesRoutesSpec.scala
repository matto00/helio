package com.helio.api.routes.agents

import com.helio.api.routes.agents.AgentPreferencesRoutes
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.JsonProtocols
import com.helio.api.protocols.agents.{AgentPreferencesResponse, PutAgentPreferencesRequest, PutMemoryEnabledRequest}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.agents.AgentPreferencesRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.agents.AgentPreferencesService
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

/** HEL-472 (420-A) — HTTP-layer coverage for `GET`/`PUT /api/preferences`: default-object
 *  response when nothing is stored, round-trip of every field, and 401 without auth
 *  (tasks.md 4.3). Mirrors `PipelineScheduleRoutesSpec`'s isolated-route-class pattern.
 *
 *  HEL-531 (420-E) tasks.md 5.6 — also covers the new `PUT /preferences/memory-enabled` endpoint
 *  (opt out, opt back in) and a route-level proof that `PUT /preferences` doesn't reset a
 *  previously-set `memoryEnabled`. Unauthenticated-401 coverage for the new endpoint lives in
 *  `ApiRoutesSpec` (composed-route-tree), mirroring where this file's own 401 coverage for the
 *  existing endpoints already lives — this isolated route class is constructed with an
 *  already-authenticated `AuthenticatedUser`, so 401 is not reachable from here. */
class AgentPreferencesRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres          = _
  private var db: JdbcBackend.Database                    = _
  private var repo: AgentPreferencesRepository            = _

  private val ownerAId = UUID.randomUUID().toString
  private val userA    = AuthenticatedUser(UserId(ownerAId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new AgentPreferencesRepository(new DbContext(db, db)(routeEc))(routeEc)
    seedUser()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerAId::uuid, ${s"a-$ownerAId@helio.test"}, now())"""))
  }

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_preferences"))
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new AgentPreferencesService(repo)
    new AgentPreferencesRoutes(service, user)(routeEc).routes
  }

  private val fullBody = PutAgentPreferencesRequest(
    defaultSeriesColors = Some(Vector("#ff0000", "#00ff00")),
    defaultPanelStyle   = Some(JsObject("background" -> JsString("dark"))),
    namingConventions   = Some(JsObject("titleCase" -> JsBoolean(true))),
    extras              = Some(JsObject("favoriteChart" -> JsString("bar")))
  )


  "GET /preferences" should {

    "return the default/empty object when the caller has no stored preferences" in {
      cleanDb()
      Get("/preferences") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AgentPreferencesResponse]
        resp.defaultSeriesColors shouldBe None
        resp.defaultPanelStyle shouldBe None
        resp.namingConventions shouldBe None
        resp.extras shouldBe JsObject.empty
      }
    }

    "return the caller's stored preferences" in {
      cleanDb()
      Put("/preferences", fullBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/preferences") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AgentPreferencesResponse]
        resp shouldBe AgentPreferencesResponse.fromDomain(
          await(repo.get(userA.id)).getOrElse(fail("expected a stored row"))
        )
      }
    }
  }


  "PUT /preferences" should {

    "create preferences for a user with none stored and return the persisted object" in {
      cleanDb()
      Put("/preferences", fullBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AgentPreferencesResponse]
        resp.defaultSeriesColors shouldBe Some(Vector("#ff0000", "#00ff00"))
        resp.defaultPanelStyle shouldBe Some(JsObject("background" -> JsString("dark")))
        resp.namingConventions shouldBe Some(JsObject("titleCase" -> JsBoolean(true)))
        resp.extras shouldBe JsObject("favoriteChart" -> JsString("bar"))
      }
    }

    "fully replace existing preferences: an omitted field on the second PUT is cleared" in {
      cleanDb()
      Put("/preferences", fullBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      val partialBody = PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#000000")),
        defaultPanelStyle   = None,
        namingConventions   = None,
        extras              = None
      )
      Put("/preferences", partialBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AgentPreferencesResponse]
        resp.defaultSeriesColors shouldBe Some(Vector("#000000"))
        resp.defaultPanelStyle shouldBe None
        resp.namingConventions shouldBe None
        resp.extras shouldBe JsObject.empty
      }

      Get("/preferences") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AgentPreferencesResponse].defaultPanelStyle shouldBe None
      }
    }
  }


  "PUT /preferences/memory-enabled" should {

    "opt out: a subsequent GET /preferences reflects memoryEnabled = false" in {
      cleanDb()
      Put("/preferences/memory-enabled", PutMemoryEnabledRequest(memoryEnabled = false)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AgentPreferencesResponse].memoryEnabled shouldBe false
      }

      Get("/preferences") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AgentPreferencesResponse].memoryEnabled shouldBe false
      }
    }

    "opt back in: a subsequent GET /preferences reflects memoryEnabled = true for a caller who " +
      "had previously opted out" in {
        cleanDb()
        Put("/preferences/memory-enabled", PutMemoryEnabledRequest(memoryEnabled = false)) ~> routesFor(userA) ~> check {
          status shouldBe StatusCodes.OK
        }

        Put("/preferences/memory-enabled", PutMemoryEnabledRequest(memoryEnabled = true)) ~> routesFor(userA) ~> check {
          status shouldBe StatusCodes.OK
          responseAs[AgentPreferencesResponse].memoryEnabled shouldBe true
        }

        Get("/preferences") ~> routesFor(userA) ~> check {
          status shouldBe StatusCodes.OK
          responseAs[AgentPreferencesResponse].memoryEnabled shouldBe true
        }
      }
  }

  // ── PUT /preferences must not reset memory-enabled (design.md Decision 2) ─

  "PUT /preferences (memoryEnabled carry-forward, HEL-531 / 420-E)" should {

    "not reset a previously-opted-out caller's memoryEnabled when saving unrelated preferences" in {
      cleanDb()
      Put("/preferences/memory-enabled", PutMemoryEnabledRequest(memoryEnabled = false)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      val unrelatedBody = PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#abcabc")),
        defaultPanelStyle   = None,
        namingConventions   = None,
        extras              = None
      )
      Put("/preferences", unrelatedBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AgentPreferencesResponse]
        resp.memoryEnabled shouldBe false
        resp.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
      }

      Get("/preferences") ~> routesFor(userA) ~> check {
        responseAs[AgentPreferencesResponse].memoryEnabled shouldBe false
      }
    }
  }
}
