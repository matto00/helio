package com.helio.services

import com.helio.api.protocols.CreateAgentMemoryRequest
import com.helio.domain.{AgentMemoryId, AgentMemoryKind, AuthenticatedUser, UserId}
import com.helio.infrastructure.{AgentMemoryRepository, DbContext}
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
 *  owner-isolation by `RlsOwnerTablesSpec`'s `agent_memory` section. */
class AgentMemoryServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: AgentMemoryService        = _

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
    val repo = new AgentMemoryRepository(new DbContext(db, db))
    service = new AgentMemoryService(repo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_memory"))
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
