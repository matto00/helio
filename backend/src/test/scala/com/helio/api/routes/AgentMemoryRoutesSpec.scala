package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.JsonProtocols
import com.helio.api.protocols.{AgentMemoryEntryResponse, CreateAgentMemoryRequest}
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.infrastructure.{AgentMemoryRepository, DbContext}
import com.helio.services.AgentMemoryService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-478 (420-B) — HTTP-layer coverage for `GET`/`POST /api/agent/memory`,
 *  `DELETE /api/agent/memory/:id`, and `DELETE /api/agent/memory`: create-then-list round-trip,
 *  invalid-`kind` 400, delete-then-404-on-repeat, and clear-then-empty-list (tasks.md 4.4).
 *  Composed-route-tree 401-without-auth coverage lives in `ApiRoutesSpec` (mirrors
 *  `AgentPreferencesRoutesSpec`'s split). */
class AgentMemoryRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var repo: AgentMemoryRepository          = _

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
    repo = new AgentMemoryRepository(new DbContext(db, db))
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
    await(db.run(sqlu"DELETE FROM agent_memory"))
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    val service = new AgentMemoryService(repo)(typedSystem.executionContext)
    new AgentMemoryRoutes(service, user)(typedSystem).routes
  }

  // ── GET/POST round-trip ────────────────────────────────────────────────

  "GET /agent/memory" should {

    "return an empty list when the caller has no stored entries" in {
      cleanDb()
      Get("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }

    "return the caller's entries newest-first after creating several" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "first")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/agent/memory", CreateAgentMemoryRequest("goal", "second")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val entries = responseAs[Vector[AgentMemoryEntryResponse]]
        entries.map(_.content) shouldBe Vector("second", "first")
      }
    }
  }

  "POST /agent/memory" should {

    "create an entry and return 201 with the persisted entry" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("preference-note", "dark backgrounds")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[AgentMemoryEntryResponse]
        resp.kind shouldBe "preference-note"
        resp.content shouldBe "dark backgrounds"
        resp.id should not be empty
        resp.lastUsedAt shouldBe None
      }
    }

    "return 400 and persist nothing for an invalid kind" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("hunch", "something")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }

    "return 400 and persist nothing for blank content" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "   ")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }
  }

  // ── DELETE /:id ─────────────────────────────────────────────────────────

  "DELETE /agent/memory/:id" should {

    "remove the caller's entry and return 204" in {
      cleanDb()
      var id = ""
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "to delete")) ~> routesFor(userA) ~> check {
        id = responseAs[AgentMemoryEntryResponse].id
      }

      Delete(s"/agent/memory/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }

    "return 404 on a repeat delete of the same id" in {
      cleanDb()
      var id = ""
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "to delete")) ~> routesFor(userA) ~> check {
        id = responseAs[AgentMemoryEntryResponse].id
      }

      Delete(s"/agent/memory/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Delete(s"/agent/memory/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for an id that never existed" in {
      cleanDb()
      Delete(s"/agent/memory/${UUID.randomUUID()}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── DELETE (clear all) ─────────────────────────────────────────────────

  "DELETE /agent/memory" should {

    "clear all of the caller's entries and return 204, leaving the list empty" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "one")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }
      Post("/agent/memory", CreateAgentMemoryRequest("goal", "two")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      Delete("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }

    "return 204 even when the caller already has no stored entries" in {
      cleanDb()
      Delete("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }
  }
}
