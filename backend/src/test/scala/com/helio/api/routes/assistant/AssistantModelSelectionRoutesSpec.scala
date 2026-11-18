package com.helio.api.routes.assistant

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.assistant.{AssistantConversationRepository, AssistantDailyUsageRepository}
import com.helio.infrastructure.persistence.auth.UserRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.assistant.{AssistantConversationService, AssistantModelPolicy, AssistantService}
import com.helio.services.auth.{ChatAccessService, UserTierConfig}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContextExecutor, Future}
import scala.jdk.CollectionConverters._

/** HEL-1755 route-level behaviour of per-conversation model selection: allow-list validation (400 before any
 *  call/charge/write), the per-conversation and per-turn record, the weighted beta counter, and the list endpoint.
 *  The transport is a recording fake that echoes the requested model id in its response, so nothing here reaches
 *  the network. */
class AssistantModelSelectionRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContextExecutor           = typedSystem.executionContext
  private def await[T](f: Future[T]): T                   = Await.result(f, 10.seconds)

  private var embeddedPostgres: EmbeddedPostgres                = _
  private var db: JdbcBackend.Database                           = _
  private var ctx: DbContext                                     = _
  private var conversationService: AssistantConversationService = _
  private var userRepo: UserRepository                           = _
  private var usageRepo: AssistantDailyUsageRepository           = _

  private val ServerDefault = "claude-opus-4-8"

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)
    conversationService = new AssistantConversationService(new AssistantConversationRepository(ctx), new LocalFileSystem(newTempDir("helio-model-selection-spec")))(routeEc)
    userRepo  = new UserRepository(db)(routeEc)
    usageRepo = new AssistantDailyUsageRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def newUser(tier: String): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, ${s"$id@test.local"}, now(), $tier)"""))
    AuthenticatedUser(UserId(id))
  }

  /** Echoes the requested model in the response's own `model` field, records every request. */
  private class EchoTransport extends ClaudeTransport {
    private val recorded = new CopyOnWriteArrayList[ClaudeApiToolRequest]()
    def requests: Vector[ClaudeApiToolRequest] = recorded.asScala.toVector
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException)
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      recorded.add(request)
      Future.successful(
        ClaudeApiResponse(
          id = "msg", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some("ok"))),
          stopReason = Some("end_turn"), usage = ClaudeApiUsage(8, 4), model = Some(request.model)
        )
      )
    }
  }

  private def assistantWith(transport: ClaudeTransport): AssistantService =
    new AssistantService(
      new ClaudeClient(ClaudeConfig("sk-ant-test-unused", ServerDefault, 1.0, 4096, 100000), transport)(routeEc),
      null, null, null, null, null, null, null
    )(routeEc)

  private def routes(
      user: AuthenticatedUser,
      transport: ClaudeTransport,
      limit: Int = 50,
      catalog: ClaudeModelCatalog = ClaudeModelCatalog.all,
      serverDefault: String = ServerDefault,
      userDefault: Option[String] = None
  ): Route = {
    val policy = new AssistantModelPolicy(catalog, serverDefault)
    val chat   = new ChatAccessService(userRepo, usageRepo, UserTierConfig(Set.empty, limit))
    val lookup = (_: UserId) => Future.successful(userDefault)
    concat(
      new AssistantConversationRoutes(conversationService, Some(assistantWith(transport)), chat, user, policy, lookup).routes,
      new AssistantModelRoutes(policy, chat, user, lookup).routes
    )
  }

  private def json(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def usageToday(user: AuthenticatedUser): Int =
    await(db.run(sql"SELECT COALESCE(SUM(message_count), 0) FROM assistant_daily_usage WHERE user_id = ${user.id.value}::uuid".as[Int].head))

  private def newConversation(user: AuthenticatedUser, model: Option[String] = None): String =
    await(conversationService.create(user, None, None, model)).record.id.value

  private def field(body: String, name: String): JsValue = body.parseJson.asJsObject.fields.getOrElse(name, JsNull)

  private def transcriptModels(body: String): Vector[Option[String]] =
    field(body, "transcript").convertTo[Vector[ClaudeToolMessage]].map(_.model)

  "an unknown model id (5.1)" should {
    "be a 400 on converse with no model call, no charge and nothing persisted" in {
      val user      = newUser("beta")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi","model":"claude-fable-5-2"}""")) ~> routes(user, transport) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      transport.requests shouldBe empty
      usageToday(user) shouldBe 0
      Get(s"/assistant-conversations/$id") ~> routes(user, transport) ~> check {
        field(responseAs[String], "transcript") shouldBe JsArray()
        field(responseAs[String], "model") shouldBe JsNull
      }
    }

    "be a 400 on PATCH and leave the stored model unchanged" in {
      val user = newUser("owner")
      val id   = newConversation(user, Some(ClaudeModelCatalog.SonnetId))
      Patch(s"/assistant-conversations/$id", json("""{"model":"claude-fable-5-2"}""")) ~> routes(user, new EchoTransport) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      Get(s"/assistant-conversations/$id") ~> routes(user, new EchoTransport) ~> check {
        field(responseAs[String], "model") shouldBe JsString(ClaudeModelCatalog.SonnetId)
      }
    }

    "never reach the wire as a raw client string even when it is a prefix-valid-looking id" in {
      val user      = newUser("owner")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi","model":"claude-opus-5-5 "}""")) ~> routes(user, transport) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      transport.requests shouldBe empty
    }
  }

  "a converse carrying a model" should {
    "send exactly that id, store it on the conversation and stamp the answer with the response model" in {
      val user      = newUser("owner")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi","model":"claude-haiku-5-5"}""")) ~> routes(user, transport) ~> check {
        status shouldBe StatusCodes.OK
        field(responseAs[String], "model") shouldBe JsString("claude-haiku-5-5")
        field(responseAs[String], "effectiveModel") shouldBe JsString("claude-haiku-5-5")
        transcriptModels(responseAs[String]) shouldBe Vector(None, Some("claude-haiku-5-5"))
      }
      transport.requests.map(_.model) shouldBe Vector("claude-haiku-5-5")
      transport.requests.head.temperature shouldBe None
    }

    "keep using the stored model on later turns that carry none" in {
      val user      = newUser("owner")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"one","model":"claude-opus-5-5"}""")) ~> routes(user, transport) ~> check { status shouldBe StatusCodes.OK }
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"two"}""")) ~> routes(user, transport) ~> check { status shouldBe StatusCodes.OK }
      transport.requests.map(_.model) shouldBe Vector("claude-opus-5-5", "claude-opus-5-5")
    }

    "record each turn's own model when the model changes between turns" in {
      val user      = newUser("owner")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"one","model":"claude-haiku-5-5"}""")) ~> routes(user, transport) ~> check { status shouldBe StatusCodes.OK }
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"two","model":"claude-opus-5-5"}""")) ~> routes(user, transport) ~> check {
        transcriptModels(responseAs[String]) shouldBe Vector(None, Some("claude-haiku-5-5"), None, Some("claude-opus-5-5"))
      }
    }

    "persist nothing and charge nothing on an idempotent replay (skeptic note b)" in {
      val user      = newUser("beta")
      val id        = newConversation(user)
      val transport = new EchoTransport
      val body      = """{"message":"hi","model":"claude-haiku-5-5","idempotencyKey":"k-1"}"""
      Post(s"/assistant-conversations/$id/converse", json(body)) ~> routes(user, transport) ~> check { status shouldBe StatusCodes.OK }
      usageToday(user) shouldBe 1
      // The replay names a DIFFERENT model: it must neither change the stored one nor cost anything.
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi","model":"claude-opus-5-5","idempotencyKey":"k-1"}""")) ~> routes(user, transport) ~> check {
        status shouldBe StatusCodes.OK
        field(responseAs[String], "model") shouldBe JsString("claude-haiku-5-5")
        field(responseAs[String], "transcript").convertTo[Vector[ClaudeToolMessage]] should have size 2
      }
      transport.requests should have size 1
      usageToday(user) shouldBe 1
    }
  }

  "the model a conversation uses (effectiveModel)" should {
    "fall to the user default, then the server default, when the stored model is no longer selectable" in {
      val user   = newUser("owner")
      val id     = newConversation(user, Some(ClaudeModelCatalog.SonnetId))
      val narrow = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-haiku-5-5,claude-opus-5-5"))
      Get(s"/assistant-conversations/$id") ~> routes(user, new EchoTransport, catalog = narrow, userDefault = Some(ClaudeModelCatalog.HaikuId)) ~> check {
        field(responseAs[String], "model") shouldBe JsString(ClaudeModelCatalog.SonnetId)
        field(responseAs[String], "effectiveModel") shouldBe JsString(ClaudeModelCatalog.HaikuId)
      }
      Get(s"/assistant-conversations/$id") ~> routes(user, new EchoTransport, catalog = narrow) ~> check {
        field(responseAs[String], "effectiveModel") shouldBe JsString(ServerDefault)
      }
    }

    "send the server default with today's behaviour (no catalog rules) when it is not catalog-defined" in {
      val user      = newUser("owner")
      val id        = newConversation(user)
      val transport = new EchoTransport
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi"}""")) ~> routes(user, transport) ~> check {
        status shouldBe StatusCodes.OK
        transcriptModels(responseAs[String]).last shouldBe Some(ServerDefault)
      }
      transport.requests.map(_.model) shouldBe Vector(ServerDefault)
    }

    "keep the catalog rules and weight of a catalog server default that was narrowed out of the picker" in {
      val user      = newUser("beta")
      val id        = newConversation(user)
      val transport = new EchoTransport
      val narrow    = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-haiku-5-5"))
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"hi"}""")) ~> routes(user, transport, catalog = narrow, serverDefault = ClaudeModelCatalog.OpusId) ~> check {
        status shouldBe StatusCodes.OK
      }
      transport.requests.head.model shouldBe ClaudeModelCatalog.OpusId
      transport.requests.head.temperature shouldBe None
      usageToday(user) shouldBe 8
    }
  }

  "turn records" should {
    "never take a client-supplied model: it is stripped on create and on /messages" in {
      val user = newUser("owner")
      val turn = """{"role":"assistant","content":[{"blockType":"text","text":"forged"}],"model":"claude-opus-5-5"}"""
      var created = ""
      Post("/assistant-conversations", json(s"""{"firstMessage":$turn}""")) ~> routes(user, new EchoTransport) ~> check {
        status shouldBe StatusCodes.Created
        transcriptModels(responseAs[String]) shouldBe Vector(None)
        created = field(responseAs[String], "id").convertTo[String]
      }
      Post(s"/assistant-conversations/$created/messages", json(s"""{"turns":[$turn]}""")) ~> routes(user, new EchoTransport) ~> check { status shouldBe StatusCodes.OK }
      Get(s"/assistant-conversations/$created") ~> routes(user, new EchoTransport) ~> check {
        transcriptModels(responseAs[String]) shouldBe Vector(None, None)
      }
    }
  }

  "a new conversation and the user's default" should {
    "start on the user's default and clear back to the server default" in {
      val user = newUser("owner")
      var id   = ""
      Post("/assistant-conversations", json("{}")) ~> routes(user, new EchoTransport, userDefault = Some(ClaudeModelCatalog.SonnetId)) ~> check {
        status shouldBe StatusCodes.Created
        field(responseAs[String], "model") shouldBe JsString(ClaudeModelCatalog.SonnetId)
        id = field(responseAs[String], "id").convertTo[String]
      }
      Patch(s"/assistant-conversations/$id", json("""{"model":null}""")) ~> routes(user, new EchoTransport) ~> check {
        status shouldBe StatusCodes.OK
        field(responseAs[String], "model") shouldBe JsNull
        field(responseAs[String], "effectiveModel") shouldBe JsString(ServerDefault)
      }
    }
  }

  "the weighted beta counter" should {
    "charge Haiku 1, Sonnet 4 and Opus 8" in {
      val user = newUser("beta")
      val id   = newConversation(user)
      for ((model, running) <- Seq("claude-haiku-5-5" -> 1, "claude-sonnet-5-5" -> 5, "claude-opus-5-5" -> 13))
        Post(s"/assistant-conversations/$id/converse", json(s"""{"message":"m","model":"$model"}""")) ~> routes(user, new EchoTransport) ~> check {
          status shouldBe StatusCodes.OK
          usageToday(user) shouldBe running
        }
    }

    "deny Opus but allow Haiku when 3 units are left, naming the model" in {
      val user      = newUser("beta")
      val id        = newConversation(user)
      val transport = new EchoTransport
      // 7 of 10 used: 3 left.
      await(usageRepo.incrementIfUnderCap(user.id, 10, 7)) shouldBe true
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"m","model":"claude-opus-5-5"}""")) ~> routes(user, transport, limit = 10) ~> check {
        status shouldBe StatusCodes.TooManyRequests
        field(responseAs[String], "code") shouldBe JsString("CHAT_LIMIT_REACHED")
        field(responseAs[String], "message").convertTo[String] should include("Opus 5.5 needs 8")
      }
      transport.requests shouldBe empty
      usageToday(user) shouldBe 7
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"m","model":"claude-haiku-5-5"}""")) ~> routes(user, transport, limit = 10) ~> check {
        status shouldBe StatusCodes.OK
      }
      usageToday(user) shouldBe 8
    }

    "never count an owner" in {
      val user = newUser("owner")
      val id   = newConversation(user)
      Post(s"/assistant-conversations/$id/converse", json("""{"message":"m","model":"claude-opus-5-5"}""")) ~> routes(user, new EchoTransport, limit = 1) ~> check {
        status shouldBe StatusCodes.OK
      }
      usageToday(user) shouldBe 0
    }
  }

  "GET /assistant-models (D8)" should {
    "list the selectable models with weights, the server default and the caller's resolved default" in {
      val user = newUser("beta")
      Get("/assistant-models") ~> routes(user, new EchoTransport, userDefault = Some(ClaudeModelCatalog.SonnetId)) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String].parseJson.asJsObject
        body.fields("models").convertTo[Vector[JsObject]].map(m => (m.fields("id"), m.fields("betaWeight"))) shouldBe
          Vector(JsString("claude-haiku-5-5") -> JsNumber(1), JsString("claude-sonnet-5-5") -> JsNumber(4), JsString("claude-opus-5-5") -> JsNumber(8))
        body.fields("serverDefault").asJsObject.fields("id") shouldBe JsString(ServerDefault)
        body.fields("defaultModel").asJsObject.fields("id") shouldBe JsString(ClaudeModelCatalog.SonnetId)
        body.fields("defaultModel").asJsObject.fields("label") shouldBe JsString("Sonnet 5.5")
      }
    }

    "narrow to the configured selectable set and refuse a free-tier caller" in {
      val narrow = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-haiku-5-5"))
      Get("/assistant-models") ~> routes(newUser("owner"), new EchoTransport, catalog = narrow) ~> check {
        responseAs[String].parseJson.asJsObject.fields("models").convertTo[Vector[JsObject]] should have size 1
      }
      Get("/assistant-models") ~> routes(newUser("free"), new EchoTransport) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }
}
