package com.helio.services.agents

import com.helio.services.agents.AgentPreferencesService
import com.helio.api.protocols.agents.PutAgentPreferencesRequest
import com.helio.domain.model.{AgentPreferences, AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.agents.AgentPreferencesRepository
import com.helio.infrastructure.persistence.DbContext
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

/** HEL-472 (420-A) — `AgentPreferencesService` get-returns-defaults-when-absent and
 *  put-is-a-full-replace (tasks.md 2.2/4.1). Owner isolation itself is covered by
 *  `RlsOwnerTablesSpec`'s `agent_preferences` section; this spec exercises the service's own
 *  defaulting/replace semantics against a single user.
 *
 *  HEL-531 (420-E) tasks.md 5.1 — also exercises the `memoryEnabled` opt-out: `get`'s
 *  default-true behavior, `put`'s carry-forward-unchanged behavior (design.md Decision 2), and
 *  `setMemoryEnabled`'s dedicated write path. */
class AgentPreferencesServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: AgentPreferencesService   = _

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
    val repo = new AgentPreferencesRepository(new DbContext(db, db))
    service = new AgentPreferencesService(repo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_preferences"))
    await(db.run(sqlu"DELETE FROM users"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"$owner1Id@helio.test"}, now())"""))
  }

  "AgentPreferencesService.get" should {

    "return an all-empty default when the caller has no stored row" in {
      cleanDb()
      await(service.get(user1)) shouldBe AgentPreferences.empty(owner1, AgentPreferencesService.DefaultMemoryEnabled)
    }

    "default memoryEnabled to true for a new user with no stored row (HEL-531 / 420-E)" in {
      cleanDb()
      await(service.get(user1)).memoryEnabled shouldBe true
    }

    "return the stored preferences once put has been called" in {
      cleanDb()
      val req = PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#abcabc")),
        defaultPanelStyle   = Some(JsObject("transparency" -> JsNumber(0.5))),
        namingConventions   = Some(JsObject("dashboardTitleCase" -> JsString("sentence"))),
        extras              = Some(JsObject("k" -> JsString("v")))
      )
      await(service.put(user1, req))

      val fetched = await(service.get(user1))
      fetched.userId shouldBe owner1
      fetched.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
      fetched.defaultPanelStyle shouldBe Some(JsObject("transparency" -> JsNumber(0.5)))
      fetched.namingConventions shouldBe Some(JsObject("dashboardTitleCase" -> JsString("sentence")))
      fetched.extras shouldBe JsObject("k" -> JsString("v"))
    }
  }

  "AgentPreferencesService.put" should {

    "always set userId from the authenticated caller, never from the request" in {
      cleanDb()
      val req = PutAgentPreferencesRequest(None, None, None, None)
      val result = await(service.put(user1, req))
      result.userId shouldBe owner1
    }

    "normalize an absent extras key to an empty object" in {
      cleanDb()
      val result = await(service.put(user1, PutAgentPreferencesRequest(None, None, None, extras = None)))
      result.extras shouldBe JsObject.empty
    }

    "treat an absent extras key identically to an explicit empty object" in {
      cleanDb()
      val absent   = await(service.put(user1, PutAgentPreferencesRequest(None, None, None, extras = None)))
      val explicit = await(service.put(user1, PutAgentPreferencesRequest(None, None, None, extras = Some(JsObject.empty))))
      absent.extras shouldBe explicit.extras
    }

    "is a full replace: a second put omitting a previously-set field clears it (not a merge)" in {
      cleanDb()
      val first = PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#111111")),
        defaultPanelStyle   = Some(JsObject("background" -> JsString("light"))),
        namingConventions   = Some(JsObject("titleCase" -> JsBoolean(false))),
        extras              = Some(JsObject("note" -> JsString("first")))
      )
      await(service.put(user1, first))

      val second = PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#222222")),
        defaultPanelStyle   = None,
        namingConventions   = None,
        extras              = None
      )
      val replaced = await(service.put(user1, second))

      replaced.defaultSeriesColors shouldBe Some(Vector("#222222"))
      replaced.defaultPanelStyle shouldBe None
      replaced.namingConventions shouldBe None
      replaced.extras shouldBe JsObject.empty

      // A subsequent get reflects the replace, not the first put's values.
      await(service.get(user1)) shouldBe replaced
    }


    "preserve a previously-opted-out caller's memoryEnabled while updating the other four fields " +
      "(design.md Decision 2)" in {
        cleanDb()
        await(service.setMemoryEnabled(user1, enabled = false))

        val result = await(service.put(user1, PutAgentPreferencesRequest(
          defaultSeriesColors = Some(Vector("#abcabc")), defaultPanelStyle = None, namingConventions = None, extras = None
        )))

        result.memoryEnabled shouldBe false
        result.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
        await(service.get(user1)).memoryEnabled shouldBe false
      }

    "preserve memoryEnabled = true across a put when the caller never opted out" in {
      cleanDb()
      val result = await(service.put(user1, PutAgentPreferencesRequest(None, None, None, None)))
      result.memoryEnabled shouldBe true
    }
  }

  "AgentPreferencesService.setMemoryEnabled" should {

    "persist the flag and leave the other four fields unchanged when opting out after a prior put" in {
      cleanDb()
      await(service.put(user1, PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#abcabc")),
        defaultPanelStyle   = Some(JsObject("background" -> JsString("dark"))),
        namingConventions   = Some(JsObject("titleCase" -> JsBoolean(true))),
        extras              = Some(JsObject("k" -> JsString("v")))
      )))

      val result = await(service.setMemoryEnabled(user1, enabled = false))

      result.memoryEnabled shouldBe false
      result.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
      result.defaultPanelStyle shouldBe Some(JsObject("background" -> JsString("dark")))
      result.namingConventions shouldBe Some(JsObject("titleCase" -> JsBoolean(true)))
      result.extras shouldBe JsObject("k" -> JsString("v"))

      await(service.get(user1)) shouldBe result
    }

    "persist the flag and leave the other four fields unchanged when opting back in" in {
      cleanDb()
      await(service.setMemoryEnabled(user1, enabled = false))
      await(service.put(user1, PutAgentPreferencesRequest(
        defaultSeriesColors = Some(Vector("#111111")), defaultPanelStyle = None, namingConventions = None, extras = None
      )))

      val result = await(service.setMemoryEnabled(user1, enabled = true))

      result.memoryEnabled shouldBe true
      result.defaultSeriesColors shouldBe Some(Vector("#111111"))
      await(service.get(user1)).memoryEnabled shouldBe true
    }
  }
}
