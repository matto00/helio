package com.helio.api.routes.sources

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ConnectorMeta, ConnectorsResponse, ErrorResponse, JsonProtocols}
import com.helio.domain.model.{AuthenticatedUser, ConnectorId, DataSourceKind, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.ConnectorEntityService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-821 — HTTP-layer coverage for `/api/connectors`: happy-path CRUD, the
 *  no-secret-in-response contract on every response shape (task 4.2 forward
 *  pass), update rejecting a credential field with 400 (task 3.3 / design.md
 *  Decision 3), and the delete-with-dependents 409 seam exercised through the
 *  real route (task 4.6). */
class ConnectorEntityRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var connectorRepo: ConnectorRepository = _

  private val ownerAId = UUID.randomUUID().toString
  private val ownerBId = UUID.randomUUID().toString
  private val userA    = AuthenticatedUser(UserId(ownerAId))
  private val userB    = AuthenticatedUser(UserId(ownerBId))

  private def randomKeyB64(): String = {
    val bytes = new Array[Byte](32)
    new SecureRandom().nextBytes(bytes)
    Base64.getEncoder.encodeToString(bytes)
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    val backend = new EncryptedSecretBackend(
      new EnvMasterKeyProvider(Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "route-spec-key"))
    )
    val credentialRepo = new ConnectorCredentialRepository(ctx, backend)(routeEc)
    connectorRepo = new ConnectorRepository(ctx, credentialRepo)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerAId::uuid, ${s"a-$ownerAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerBId::uuid, ${s"b-$ownerBId@helio.test"}, now())"""
    )))
  }

  private def routesFor(user: AuthenticatedUser, dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0)): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new ConnectorEntityService(connectorRepo, dependentCount)
    new ConnectorEntityRoutes(service, user)(typedSystem).routes
  }

  private def createBody(name: String = "Stripe", credential: String = "sk_live_abc123"): JsObject =
    JsObject(
      "name"       -> JsString(name),
      "kind"       -> JsString(DataSourceKind.RestApi),
      "baseUrl"    -> JsString("https://api.stripe.com"),
      "config"     -> JsObject.empty,
      "credential" -> JsString(credential)
    )

  "POST /api/connectors" should {
    "creates a Connector and never echoes the credential (task 4.2 forward pass)" in {
      val creds = createBody(credential = "sk_super_secret_key")
      Post("/connectors", creds) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val meta = responseAs[ConnectorMeta]
        meta.name shouldBe "Stripe"
        meta.kind shouldBe DataSourceKind.RestApi
        // Structural + textual proof: the whole response body never contains
        // the plaintext credential.
        meta.productElementNames.toSet shouldBe
          Set("id", "ownerId", "name", "kind", "baseUrl", "config", "createdAt", "updatedAt", "dependentCount")
        responseAs[String] should not include "sk_super_secret_key"
      }
    }

    // HEL-824 design.md Decision 1b: a brand-new Connector has no dependents yet.
    "returns dependentCount = 0 for a freshly created Connector (task 1.3)" in {
      val creds = createBody(name = "Fresh", credential = "fresh-secret")
      Post("/connectors", creds) ~> routesFor(userA) ~> check {
        responseAs[ConnectorMeta].dependentCount shouldBe 0
      }
    }

    "rejects a request missing a credential" in {
      val body = JsObject(
        "name"    -> JsString("No cred"),
        "kind"    -> JsString(DataSourceKind.RestApi),
        "baseUrl" -> JsString("https://example.com"),
        "config"  -> JsObject.empty,
        "credential" -> JsString("")
      )
      Post("/connectors", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // HEL-822 design.md Decision 6 revised (CR6) / task 2.1b: a no-auth Connector is
    // creatable with an explicitly-empty credential; bearer/api_key still reject one.
    "allows an empty credential when config.authType is \"none\" (task 2.1b)" in {
      val body = JsObject(
        "name"       -> JsString("No-auth"),
        "kind"       -> JsString(DataSourceKind.RestApi),
        "baseUrl"    -> JsString("https://example.com"),
        "config"     -> JsObject("authType" -> JsString("none")),
        "credential" -> JsString("")
      )
      Post("/connectors", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "still rejects an empty credential when config.authType is \"bearer\" (task 2.1b, unchanged)" in {
      val body = JsObject(
        "name"       -> JsString("Bearer no cred"),
        "kind"       -> JsString(DataSourceKind.RestApi),
        "baseUrl"    -> JsString("https://example.com"),
        "config"     -> JsObject("authType" -> JsString("bearer")),
        "credential" -> JsString("")
      )
      Post("/connectors", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // HEL-822 design.md Decision 1a revised (CR5) / task 1.2b: `implicit` is server-owned --
    // a client-supplied `true` on a direct POST is silently overridden to `false`, never
    // persisted as the client sent it.
    "persists config.implicit = false regardless of a client-supplied true (task 1.2b)" in {
      val body = JsObject(
        "name"       -> JsString("Implicit spoof attempt"),
        "kind"       -> JsString(DataSourceKind.RestApi),
        "baseUrl"    -> JsString("https://example.com"),
        "config"     -> JsObject("authType" -> JsString("none"), "implicit" -> JsBoolean(true)),
        "credential" -> JsString("")
      )
      Post("/connectors", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[ConnectorMeta].config.asJsObject.fields("implicit") shouldBe JsBoolean(false)
      }
    }
  }

  "GET /api/connectors and GET /api/connectors/:id" should {
    "list and read metadata only, never the credential (task 4.2 forward pass)" in {
      val creds = createBody(name = "Listable", credential = "list-secret-value")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      Get("/connectors") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val listed = responseAs[ConnectorsResponse]
        listed.items.map(_.id) should contain(created.id)
        responseAs[String] should not include "list-secret-value"
      }

      Get(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should not include "list-secret-value"
      }
    }

    "returns not-found for another user's Connector (cross-user ACL)" in {
      val creds = createBody(name = "A-only", credential = "a-only-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      Get(s"/connectors/${created.id}") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /api/connectors/:id" should {
    "updates non-secret fields" in {
      val creds = createBody(name = "Original", credential = "patch-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val update = JsObject("name" -> JsString("Renamed"))
      Patch(s"/connectors/${created.id}", update) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[ConnectorMeta].name shouldBe "Renamed"
      }
    }

    "rejects a request body containing a credential field with 400, not silent ignore (task 3.3 / AC3)" in {
      val creds = createBody(name = "Rotate attempt", credential = "original-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val update = JsObject("name" -> JsString("New name"), "credential" -> JsString("new-secret-value"))
      Patch(s"/connectors/${created.id}", update) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("credential")
      }

      // Confirm the update was NOT applied at all (name unchanged too).
      Get(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        responseAs[ConnectorMeta].name shouldBe "Rotate attempt"
      }
    }

    // HEL-822 design.md Decision 1a revised (CR5) / task 1.2b: a PATCH cannot flip an
    // existing Connector's `implicit` flag via a client-supplied `config`, in either
    // direction -- created here as a normal (implicit: false) Connector, a PATCH trying to
    // flip it to true is silently overridden back to false.
    "PATCH cannot flip config.implicit via a client-supplied config (task 1.2b)" in {
      val creds = createBody(name = "Not implicit", credential = "flip-attempt-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }
      created.config.asJsObject.fields("implicit") shouldBe JsBoolean(false)

      val update = JsObject("config" -> JsObject("authType" -> JsString("none"), "implicit" -> JsBoolean(true)))
      Patch(s"/connectors/${created.id}", update) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[ConnectorMeta].config.asJsObject.fields("implicit") shouldBe JsBoolean(false)
      }
    }
  }

  "DELETE /api/connectors/:id" should {
    "deletes a Connector with no dependents" in {
      val creds = createBody(name = "Deletable", credential = "delete-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      Delete(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "returns 409 ConnectorHasDependents and performs no deletion when dependentCount is nonzero (task 4.6 / AC6)" in {
      val creds = createBody(name = "Has dependents", credential = "dep-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val nonzeroDependents: ConnectorId => Future[Int] = _ => Future.successful(1)
      Delete(s"/connectors/${created.id}") ~> routesFor(userA, nonzeroDependents) ~> check {
        status shouldBe StatusCodes.Conflict
        responseAs[ErrorResponse].message should include("ConnectorHasDependents")
      }

      Get(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "GET reflecting dependentCount (task 1.3)" should {
    "reflects the injected dependentCount collaborator on list and single reads, 0/1/N" in {
      val creds = createBody(name = "Counted", credential = "counted-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      Get(s"/connectors/${created.id}") ~> routesFor(userA) ~> check {
        responseAs[ConnectorMeta].dependentCount shouldBe 0
      }

      val oneDependent: ConnectorId => Future[Int] = _ => Future.successful(1)
      Get(s"/connectors/${created.id}") ~> routesFor(userA, oneDependent) ~> check {
        responseAs[ConnectorMeta].dependentCount shouldBe 1
      }
      Get("/connectors") ~> routesFor(userA, oneDependent) ~> check {
        responseAs[ConnectorsResponse].items.find(_.id == created.id).get.dependentCount shouldBe 1
      }

      val threeDependents: ConnectorId => Future[Int] = _ => Future.successful(3)
      Get(s"/connectors/${created.id}") ~> routesFor(userA, threeDependents) ~> check {
        responseAs[ConnectorMeta].dependentCount shouldBe 3
      }
    }
  }

  "PUT /api/connectors/:id/credential" should {
    "rotates the credential and never echoes it, keeping dependentCount accurate (tasks 2.4/2.5)" in {
      val creds = createBody(name = "Rotatable", credential = "old-secret-value")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val rotateBody = JsObject("credential" -> JsString("new-secret-value"))
      Put(s"/connectors/${created.id}/credential", rotateBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val rotated = responseAs[ConnectorMeta]
        rotated.id shouldBe created.id
        rotated.dependentCount shouldBe 0
        responseAs[String] should not include "new-secret-value"
        responseAs[String] should not include "old-secret-value"
      }
    }

    "rejects an empty credential with 400" in {
      val creds = createBody(name = "Rotate empty", credential = "some-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val rotateBody = JsObject("credential" -> JsString(""))
      Put(s"/connectors/${created.id}/credential", rotateBody) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "returns not-found for another user's Connector (cross-user ACL, task 2.5)" in {
      val creds = createBody(name = "Cross-user rotate", credential = "cross-secret")
      val created = Post("/connectors", creds) ~> routesFor(userA) ~> check { responseAs[ConnectorMeta] }

      val rotateBody = JsObject("credential" -> JsString("attempted-new-value"))
      Put(s"/connectors/${created.id}/credential", rotateBody) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
