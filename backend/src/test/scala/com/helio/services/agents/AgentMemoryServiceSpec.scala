package com.helio.services.agents


import com.helio.services.ServiceError
import com.helio.services.agents.{AgentMemoryService, AgentPreferencesService}
import com.helio.api.protocols.agents.CreateAgentMemoryRequest
import com.helio.domain.model.{AgentMemoryId, AgentMemoryKind, AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.agents.{AgentMemoryRepository, AgentPreferencesRepository}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-478 (420-B) — `AgentMemoryService.add`'s `kind`/blank-`content` validation (tasks.md
 *  4.2). Cap-and-evict mechanics themselves are covered by `AgentMemoryRepositorySpec`; RLS
 *  owner-isolation by `RlsOwnerTablesSpec`'s `agent_memory` section.
 *
 *  HEL-531 (420-E) tasks.md 5.2 — also exercises the `memoryEnabled` opt-out: `add` is a no-op
 *  (no row persisted, still success) when disabled, and behaves normally when enabled. */
class AgentMemoryServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var service: AgentMemoryService                  = _
  private var agentPreferencesService: AgentPreferencesService = _

  private val owner1Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val user1    = AuthenticatedUser(owner1)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    val repo = new AgentMemoryRepository(ctx)
    agentPreferencesService = new AgentPreferencesService(new AgentPreferencesRepository(ctx))
    service = new AgentMemoryService(repo, agentPreferencesService)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_memory"))
    await(db.run(sqlu"DELETE FROM agent_preferences"))
    await(db.run(sqlu"DELETE FROM users"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"$owner1Id@helio.test"}, now())"""))
  }

  "AgentMemoryService.add" should {

    "persist a valid fact entry owned by the caller" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("fact", "user loves Netflix dashboards"), user1))
      result match {
        case Right(entry) =>
          entry.ownerId shouldBe owner1
          entry.kind shouldBe AgentMemoryKind.Fact
          entry.content shouldBe "user loves Netflix dashboards"
        case Left(err) => fail(s"expected Right, got $err")
      }
    }

    "persist a valid goal entry" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("goal", "always add sentiment coloring"), user1))
      result.map(_.kind) shouldBe Right(AgentMemoryKind.Goal)
    }

    "persist a valid preference-note entry" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("preference-note", "prefers dark backgrounds"), user1))
      result.map(_.kind) shouldBe Right(AgentMemoryKind.PreferenceNote)
    }

    "reject a kind outside the fact/goal/preference-note allow-list" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("hunch", "something"), user1))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[ServiceError.BadRequest]

      await(service.list(user1)) shouldBe Right(Seq.empty)
    }

    "reject empty content" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("fact", ""), user1))
      result.left.toOption.get shouldBe a[ServiceError.BadRequest]

      await(service.list(user1)) shouldBe Right(Seq.empty)
    }

    "reject whitespace-only content" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("fact", "   \n\t  "), user1))
      result.left.toOption.get shouldBe a[ServiceError.BadRequest]

      await(service.list(user1)) shouldBe Right(Seq.empty)
    }

    "trim content before storing" in {
      cleanDb()
      val result = await(service.add(CreateAgentMemoryRequest("fact", "  padded content  "), user1))
      result.map(_.content) shouldBe Right("padded content")
    }


    "be a no-op when memoryEnabled is false: no row persisted, still a normal success response" in {
      cleanDb()
      await(agentPreferencesService.setMemoryEnabled(user1, enabled = false))

      val result = await(service.add(CreateAgentMemoryRequest("fact", "should not be captured"), user1))
      result shouldBe a[Right[_, _]]
      result.map(_.content) shouldBe Right("should not be captured")

      await(service.list(user1)) shouldBe Right(Seq.empty)
    }

    "behave normally (persists) when memoryEnabled is true (the default)" in {
      cleanDb()
      await(agentPreferencesService.setMemoryEnabled(user1, enabled = true))

      val result = await(service.add(CreateAgentMemoryRequest("fact", "captured normally"), user1))
      result.map(_.content) shouldBe Right("captured normally")

      await(service.list(user1)).map(_.map(_.content)) shouldBe Right(Seq("captured normally"))
    }
  }

  "AgentMemoryService.delete" should {

    "return NotFound for an unknown id" in {
      cleanDb()
      val result = await(service.delete(AgentMemoryId(UUID.randomUUID().toString), user1))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[ServiceError.NotFound]
    }
  }

  "AgentMemoryService.clear" should {

    "always succeed, even with nothing stored" in {
      cleanDb()
      await(service.clear(user1)) shouldBe Right(())
    }
  }
}
