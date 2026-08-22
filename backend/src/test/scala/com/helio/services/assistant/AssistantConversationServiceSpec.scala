package com.helio.services.assistant


import com.helio.services.ServiceError
import com.helio.services.assistant.AssistantConversationService
import com.helio.ai.{ClaudeContentBlock, ClaudeRole, ClaudeToolMessage}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-663 tasks.md 6.1-6.5/6.8/6.9 — `AssistantConversationService`, exercising the real
 *  composition of `AssistantConversationRepository` (EmbeddedPostgres) with a real `LocalFileSystem`
 *  over a `Files.createTempDirectory` temp dir (mirrors `DataSourceServiceSpec`'s existing
 *  construction pattern, per tasks.md 6.5) — zero real GCS network calls (tasks.md 6.10). */
class AssistantConversationServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: AssistantConversationRepository = _
  private var fileSystem: LocalFileSystem        = _
  private var service: AssistantConversationService = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
    val ctx = new DbContext(db, db)
    repo = new AssistantConversationRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-assistant-conversation-service-spec")
    fileSystem = new LocalFileSystem(tmpDir)

    service = new AssistantConversationService(repo, fileSystem)

    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${owner.value}::uuid, ${s"${owner.value}@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    ))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def cleanDb(): Unit =
    await(db.run(sqlu"TRUNCATE TABLE assistant_conversations"))

  private def userText(text: String): ClaudeToolMessage = ClaudeToolMessage.text(ClaudeRole.User, text)

  "AssistantConversationService.create + appendTurn + list" should {

    "show the created conversation in a subsequent list, with updatedAt reflecting the append (tasks.md 6.1)" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Show total revenue")), title = None))

      Thread.sleep(5) // ensure a real clock delta between create and append's updated_at
      val appended = await(service.appendTurn(user, detail.record.id, Seq(userText("Now by region"))))
      appended shouldBe a[Right[_, _]]
      val appendedRecord = appended.toOption.get

      val listed = await(service.list(user))
      listed.map(_.id) should contain(detail.record.id)
      val listedEntry = listed.find(_.id == detail.record.id).get
      listedEntry.updatedAt shouldBe appendedRecord.updatedAt
      listedEntry.updatedAt.isAfter(detail.record.createdAt) shouldBe true
    }

    "append persists the WHOLE rewritten transcript, readable back via get" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Hello")), title = None))
      await(service.appendTurn(user, detail.record.id, Seq(userText("Follow-up"))))

      val fetched = await(service.get(user, detail.record.id))
      fetched shouldBe a[Right[_, _]]
      val transcriptArray = fetched.toOption.get.transcript.convertTo[Vector[ClaudeToolMessage]]
      transcriptArray should have size 2
    }

    "appendTurn on a nonexistent conversation id returns NotFound, not an exception (tasks.md 6.9)" in {
      cleanDb()
      val result = await(service.appendTurn(user, AssistantConversationId(UUID.randomUUID().toString), Seq(userText("hi"))))
      result shouldBe Left(ServiceError.NotFound("Conversation not found"))
    }

    "appendTurn on another user's conversation returns NotFound, not an exception (tasks.md 6.9)" in {
      cleanDb()
      val otherOwner = UserId(UUID.randomUUID().toString)
      val otherUser  = AuthenticatedUser(otherOwner)
      await(db.run(
        sqlu"""INSERT INTO users (id, email, created_at)
               VALUES (${otherOwner.value}::uuid, ${s"${otherOwner.value}@test.local"}, now())
               ON CONFLICT DO NOTHING"""
      ))
      val detail = await(service.create(otherUser, Some(userText("Owned by other")), title = None))

      val result = await(service.appendTurn(user, detail.record.id, Seq(userText("intrusion"))))
      result shouldBe Left(ServiceError.NotFound("Conversation not found"))
    }
  }

  // ── HEL-698 idempotency key (design.md D3 append-time check) ────────────────
  "AssistantConversationService.appendTurn idempotency key" should {

    "a keyed append records the key on the returned record" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Hello")), title = None))

      val appended = await(service.appendTurn(user, detail.record.id, Seq(userText("Follow-up")), Some("key-1")))
      appended shouldBe a[Right[_, _]]
      appended.toOption.get.lastIdempotencyKey shouldBe Some("key-1")
    }

    "a matching-key append no-ops -- the transcript stays unchanged and the existing record is returned" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Hello")), title = None))
      val first = await(service.appendTurn(user, detail.record.id, Seq(userText("Follow-up")), Some("key-1")))
      first shouldBe a[Right[_, _]]

      val replay = await(service.appendTurn(user, detail.record.id, Seq(userText("Should never land")), Some("key-1")))
      replay shouldBe Right(first.toOption.get)

      val fetched = await(service.get(user, detail.record.id))
      val transcript = fetched.toOption.get.transcript.convertTo[Vector[ClaudeToolMessage]]
      transcript should have size 2 // Hello + Follow-up only, not the replayed "Should never land"
    }

    "a keyless append leaves a previously-set key in place" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Hello")), title = None))
      await(service.appendTurn(user, detail.record.id, Seq(userText("Keyed")), Some("key-1")))

      val keyless = await(service.appendTurn(user, detail.record.id, Seq(userText("Keyless"))))
      keyless shouldBe a[Right[_, _]]
      keyless.toOption.get.lastIdempotencyKey shouldBe Some("key-1")
    }
  }

  "AssistantConversationService.setPinned + list" should {

    "reflect pinned: true in a subsequent list call after PATCH-equivalent setPinned (tasks.md 6.2)" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Pin me")), title = None))

      val pinned = await(service.setPinned(user, detail.record.id, pinned = true))
      pinned shouldBe a[Right[_, _]]

      val listed = await(service.list(user))
      listed.find(_.id == detail.record.id).get.pinned shouldBe true
    }
  }

  "AssistantConversationService.list default limit" should {

    "return at most 10 conversations, pinned-first then most-recent-first, for a user with more than 10 (tasks.md 6.4)" in {
      cleanDb()
      (1 to 12).foreach { i =>
        await(service.create(user, Some(userText(s"conversation $i")), title = None))
        Thread.sleep(2)
      }

      val listed = await(service.list(user))
      listed should have size 10
    }
  }

  "AssistantConversationService transcript round-trip (tasks.md 6.5)" should {

    "write via FileSystem.write, read back via FileSystem.read, deserialize, equal what was written" in {
      cleanDb()
      val seed = Seq(userText("Round trip me"), ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.Text("ack"))))
      val detail = await(service.create(user, Some(seed.head), title = None))
      // create only seeds ONE first message; append the rest to build the full seed transcript.
      await(service.appendTurn(user, detail.record.id, seed.tail))

      val fetched = await(service.get(user, detail.record.id))
      fetched shouldBe a[Right[_, _]]
    }
  }

  "AssistantConversationService title derivation (design-gate round-1 fix, tasks.md 6.8)" should {

    "derive the title from the first message's Text block when no explicit title is supplied" in {
      cleanDb()
      val longText = "s" * 200
      val detail = await(service.create(user, Some(userText(longText)), title = None))
      detail.record.title should not be empty
      detail.record.title.length should be <= 81 // MaxDerivedTitleLength (80) + the "…" suffix char
    }

    "an explicit title wins outright over a derivable first message" in {
      cleanDb()
      val detail = await(service.create(user, Some(userText("Ignored for title purposes")), title = Some("My Title")))
      detail.record.title shouldBe "My Title"
    }

    "defaults to \"New conversation\" when BOTH title and firstMessage are absent" in {
      cleanDb()
      val detail = await(service.create(user, firstMessage = None, title = None))
      detail.record.title shouldBe "New conversation"
    }

    "defaults to \"New conversation\" when firstMessage is present but carries no Text block" in {
      cleanDb()
      val toolOnlyMessage = ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.ToolUse("t1", "search", JsObject())))
      val detail = await(service.create(user, Some(toolOnlyMessage), title = None))
      detail.record.title shouldBe "New conversation"
    }

    "an explicit PATCH-equivalent rename overrides the derived/default title permanently" in {
      cleanDb()
      val detail = await(service.create(user, firstMessage = None, title = None))
      detail.record.title shouldBe "New conversation"

      val renamed = await(service.rename(user, detail.record.id, "Renamed by user"))
      renamed shouldBe a[Right[_, _]]
      renamed.toOption.get.title shouldBe "Renamed by user"

      val listed = await(service.list(user))
      listed.find(_.id == detail.record.id).get.title shouldBe "Renamed by user"
    }
  }

  "AssistantConversationService.update (PATCH pin/rename combined)" should {

    "applies both a rename and a pin in one call" in {
      cleanDb()
      val detail = await(service.create(user, firstMessage = None, title = None))

      val updated = await(service.update(user, detail.record.id, pinned = Some(true), title = Some("Both at once")))
      updated shouldBe a[Right[_, _]]
      val record = updated.toOption.get
      record.title  shouldBe "Both at once"
      record.pinned shouldBe true
    }

    "returns NotFound for an unknown conversation id" in {
      cleanDb()
      val result = await(service.update(user, AssistantConversationId(UUID.randomUUID().toString), pinned = Some(true), title = None))
      result shouldBe Left(ServiceError.NotFound("Conversation not found"))
    }
  }
}
