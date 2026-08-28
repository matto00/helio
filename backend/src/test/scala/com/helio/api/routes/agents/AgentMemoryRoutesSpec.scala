package com.helio.api.routes.agents

import com.helio.api.routes.agents.AgentMemoryRoutes
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.JsonProtocols
import com.helio.api.protocols.agents.{AgentMemoryEntryResponse, CreateAgentMemoryRequest}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.agents.{AgentMemoryRepository, AgentPreferencesRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.agents.{AgentMemoryService, AgentPreferencesService}
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
 *  `AgentPreferencesRoutesSpec`'s split).
 *
 *  HEL-531 (420-E) tasks.md 5.5 — also proves `GET`/`DELETE /api/agent/memory[/:id]` behave
 *  identically regardless of `memoryEnabled` (design.md Decision 4's "management UI unaffected"
 *  requirement). */
class AgentMemoryRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres              = _
  private var db: JdbcBackend.Database                        = _
  private var repo: AgentMemoryRepository                     = _
  private var agentPreferencesService: AgentPreferencesService = _

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
    val ctx = new DbContext(db, db)(typedSystem.executionContext)
    repo = new AgentMemoryRepository(ctx)(typedSystem.executionContext)
    agentPreferencesService = new AgentPreferencesService(new AgentPreferencesRepository(ctx)(typedSystem.executionContext))(typedSystem.executionContext)
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
    await(db.run(sqlu"DELETE FROM agent_preferences"))
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    val service = new AgentMemoryService(repo, agentPreferencesService)(typedSystem.executionContext)
    new AgentMemoryRoutes(service, user)(typedSystem).routes
  }


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

  // ── HEL-531 (420-E) tasks.md 5.5 — GET/DELETE unaffected by memoryEnabled ─

  "GET/DELETE /agent/memory[/:id] with memoryEnabled = false" should {

    "still return the caller's existing entries via GET, unchanged by opting out" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "seen-before-opt-out")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      await(agentPreferencesService.setMemoryEnabled(userA, enabled = false))

      Get("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[AgentMemoryEntryResponse]].map(_.content) shouldBe Vector("seen-before-opt-out")
      }
    }

    "still delete an individual entry via DELETE /:id, unchanged by opting out" in {
      cleanDb()
      var id = ""
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "to delete after opt-out")) ~> routesFor(userA) ~> check {
        id = responseAs[AgentMemoryEntryResponse].id
      }

      await(agentPreferencesService.setMemoryEnabled(userA, enabled = false))

      Delete(s"/agent/memory/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }

    "still clear all entries via DELETE (clear all), unchanged by opting out" in {
      cleanDb()
      Post("/agent/memory", CreateAgentMemoryRequest("fact", "one")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }

      await(agentPreferencesService.setMemoryEnabled(userA, enabled = false))

      Delete("/agent/memory") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get("/agent/memory") ~> routesFor(userA) ~> check {
        responseAs[Vector[AgentMemoryEntryResponse]] shouldBe Vector.empty
      }
    }
  }
}
