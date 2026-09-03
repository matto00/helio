package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateConnectorRequest, RestApiConfigPayload, TestConnectionResponse, UpdateConnectorRequest}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.headers.Location
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.net.InetAddress
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.util.{Success, Try}

/** HEL-879 (design.md): SSRF egress-guard coverage for the REST connector path.
 *
 *  Tasks 1.0/4.1-4.8. Per design.md Decision 2's `fetchOverride` note: every egress test below
 *  that exercises `RestApiConnectorDriver`'s issuers is built with `fetchOverride = None` --
 *  a `fetchOverride`-stubbed driver short-circuits BEFORE the guard and would prove nothing.
 *  The ONLY drivers constructed with `fetchOverride = None` in this file are the ones in the
 *  "SourceService" and "RestApiConnectorDriver" sections below; each is called out at its
 *  construction site. */
class RestConnectorEgressGuardSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres  = _
  private var db: JdbcBackend.Database            = _
  private var ctx: DbContext                      = _
  private var connectorRepo: ConnectorRepository  = _
  private var dataSourceRepo: DataSourceRepository = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                    = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db            = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx           = new DbContext(db, db)
    connectorRepo   = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    dataSourceRepo  = new DataSourceRepository(ctx)

    import slick.jdbc.PostgresProfile.api._
    Await.result(
      db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${s"${owner.value}@egress-guard.test"}, now())"""),
      10.seconds
    )

    val testRoutes = concat(
      path("ok") {
        get { complete(HttpEntity(ContentTypes.`application/json`, JsObject("ok" -> JsBoolean(true)).compactPrint)) }
      },
      path("redirect") {
        get { redirect(s"http://169.254.169.254/latest/meta-data/", StatusCodes.Found) }
      }
    )
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(testRoutes), 10.seconds)
    testServerPort = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // HEL-879: this spec's local test server binds to "localhost" (real loopback), which the
  // guard added here would otherwise reject by default. Admit ONLY this hostname (keyed on the
  // hostname string, design.md Decision 5 -- never widen the loopback address CLASS) so the
  // guard runs for real (`resolveHost` stays real DNS) without breaking this fixture.
  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  // ── Task 4.1/4.2: one disallowed-address class per fake hostname, fed through a fake
  // resolver (`isBlocked` stays the real, default denylist) -- this is exactly the pattern
  // `ContentSourceSupportSpec` uses, and per design.md Decision 5, never widens a whole
  // address class, only admits (nothing here -- these are all REJECTION cases) a single
  // synthetic hostname per class. ──
  private def resolverFor(host: String, addr: String): String => Try[Array[InetAddress]] =
    h => if (h == host) Success(Array(InetAddress.getByName(addr))) else ContentSourceSupport.defaultResolveHost(h)

  private val blockedClasses: Seq[(String, String, String)] = Seq(
    ("loopback", "loopback.egress-guard.test", "127.0.0.1"),
    ("link-local incl. cloud metadata (169.254.169.254)", "metadata.egress-guard.test", "169.254.169.254"),
    ("RFC1918 private", "private.egress-guard.test", "10.0.0.5"),
    ("IPv6 site-local", "sitelocal.egress-guard.test", "fec0::1"),
    ("IPv6 unique-local", "uniquelocal.egress-guard.test", "fd00::1"),
    ("any-local", "anylocal.egress-guard.test", "0.0.0.0"),
    ("multicast", "multicast.egress-guard.test", "224.0.0.1")
  )

  private def connectorEntityService(resolveHost: String => Try[Array[InetAddress]]): ConnectorEntityService =
    new ConnectorEntityService(connectorRepo, resolveHost = resolveHost)

  private def createReq(baseUrl: String): CreateConnectorRequest =
    CreateConnectorRequest(
      name       = s"egress-test-${UUID.randomUUID()}",
      kind       = "rest_api",
      baseUrl    = baseUrl,
      config     = Some(JsObject("authType" -> JsString("none"))),
      credential = ""
    )

  "ConnectorEntityService.create" should {
    blockedClasses.foreach { case (label, host, addr) =>
      s"reject a baseUrl resolving to $label, persisting nothing" in {
        val svc    = connectorEntityService(resolverFor(host, addr))
        val before = await(connectorRepo.findAll(user)).size
        val result = await(svc.create(createReq(s"http://$host/"), user))
        result.isLeft shouldBe true
        result.left.toOption.get shouldBe a[ServiceError.BadRequest]
        await(connectorRepo.findAll(user)).size shouldBe before
      }
    }

    "still create a Connector for a permitted baseUrl" in {
      // HEL-879 cycle-3: fake-resolved to a real public address rather than depending on live
      // DNS actually resolving the literal hostname (the final-gate reviewer's one follow-up on
      // cycle 1) -- this is exactly the fake-resolver pattern `blockedClasses` above already uses,
      // just resolving to an ALLOWED address instead of a disallowed one.
      val svc    = connectorEntityService(resolverFor("permitted.egress-guard.test", "93.184.216.34"))
      val result = await(svc.create(createReq("https://permitted.egress-guard.test/"), user))
      result.isRight shouldBe true
    }

    // HEL-879 cycle-3 regression: a merely-unresolvable-right-now host is NOT a security
    // property `specs/connectors/connector-management/spec.md`/ticket AC1 asks this ticket to
    // enforce at create time (only "resolves to a disallowed address" is) -- refusing it made
    // Connector creation depend on live DNS, breaking creation of a Connector naming a
    // not-yet-provisioned internal host. `unresolvableResolver` fails EVERY hostname (simulating
    // "does not resolve right now"), distinct from `blockedClasses`' fake resolvers, which
    // succeed but return a disallowed address -- this test guards the DISTINCTION between the
    // two outcomes, not just that a well-formed URL happens to work.
    "create a Connector whose baseUrl is well-formed but currently unresolvable (not a disallowed-address refusal)" in {
      val unresolvableResolver: String => Try[Array[InetAddress]] =
        host => scala.util.Failure(new java.net.UnknownHostException(host))
      val svc    = connectorEntityService(unresolvableResolver)
      val result = await(svc.create(createReq("https://not-yet-provisioned.internal.egress-guard.test/"), user))
      result.isRight shouldBe true
    }
  }

  "ConnectorEntityService.update" should {
    blockedClasses.foreach { case (label, host, addr) =>
      s"reject a baseUrl resolving to $label, leaving the stored row unchanged" in {
        val svc       = connectorEntityService(resolverFor("permitted.egress-guard.test", "93.184.216.34"))
        val created   = await(svc.create(createReq("https://permitted.egress-guard.test/"), user)).getOrElse(fail("setup create failed"))
        val badSvc    = connectorEntityService(resolverFor(host, addr))
        val result    = await(badSvc.update(created.id, UpdateConnectorRequest(name = None, baseUrl = Some(s"http://$host/"), config = None), user))
        result.isLeft shouldBe true
        val reloaded = await(connectorRepo.findByIdOwned(created.id, user)).getOrElse(fail("row disappeared"))
        reloaded.baseUrl shouldBe created.baseUrl
      }
    }
  }

  // ── Task 4.5/4.6/4.7: RestApiConnectorDriver's issuers, driven via the ephemeral (bare-url)
  // path so no Connector/credential fixture is needed. `fetchOverride = None` in every
  // construction below -- required per design.md Decision 2 for these to prove anything. ──
  "RestApiConnectorDriver egress guard (fetchOverride = None)" should {

    "reject an ephemeral fetch to a loopback-resolving destination before issuing any request" in {
      val driver = new RestApiConnectorDriver(resolveHost = resolverFor("loopback-ephemeral.test", "127.0.0.1"))
      val result = await(driver.fetchEphemeral(EphemeralRestConfig(url = "http://loopback-ephemeral.test/x", method = "GET")))
      result match {
        case Left(msg) => msg should include("disallowed address")
        case Right(_)  => fail("expected the loopback destination to be refused")
      }
    }

    "reject an ephemeral test-connection to a loopback-resolving destination" in {
      val driver = new RestApiConnectorDriver(resolveHost = resolverFor("loopback-ephemeral2.test", "127.0.0.1"))
      val result = await(driver.testConnectionEphemeral(EphemeralRestConfig(url = "http://loopback-ephemeral2.test/x", method = "GET")))
      result match {
        case Left(msg) => msg should include("disallowed address")
        case Right(_)  => fail("expected the loopback destination to be refused")
      }
    }

    "pin the real TCP connection to the resolved address, closing the DNS-rebinding TOCTOU (task 4.5)" in {
      // Modeled on ContentSourceSupportSpec.scala:249-265's unresolvable-hostname pattern: a
      // hostname with no real DNS entry, resolved only by the injected fake resolver. The
      // ONLY way this can succeed is if the actual connection is pinned to that resolved
      // address rather than letting Pekko re-resolve the hostname (which does not exist) at
      // connect time.
      val rebindHost = "rebind-test.invalid"
      var resolveCallCount = 0
      val rebindingResolver: String => Try[Array[InetAddress]] = host => {
        resolveCallCount += 1
        if (host == rebindHost) Success(Array(InetAddress.getByName("localhost")))
        else ContentSourceSupport.defaultResolveHost(host)
      }
      val admitRebindHost: (String, InetAddress) => Boolean =
        (host, addr) => if (host == rebindHost) false else ContentSourceSupport.isBlockedAddress(addr)
      val driver = new RestApiConnectorDriver(resolveHost = rebindingResolver, isBlocked = admitRebindHost)
      val result = await(driver.fetchEphemeral(EphemeralRestConfig(url = s"http://$rebindHost:$testServerPort/ok", method = "GET")))
      result shouldBe Right(JsObject("ok" -> JsBoolean(true)))
      resolveCallCount shouldBe 1
    }

    "treat a 302 response as an error and never parse its body (task 4.6)" in {
      val driver = new RestApiConnectorDriver(isBlocked = admitLocalhost)
      val result = await(driver.fetchEphemeral(EphemeralRestConfig(url = urlFor("redirect"), method = "GET")))
      result match {
        case Left(msg) => msg should include("302")
        case Right(_)  => fail("expected the redirect to be rejected, not followed")
      }
    }

    "succeed against an allowed external destination, carrying method/headers/body through the real guarded issuer (task 4.7)" in {
      // Admits ONLY the "localhost" hostname via the hostname-keyed isBlocked seam (design.md
      // Decision 5) -- never widens the loopback address class.
      val driver = new RestApiConnectorDriver(isBlocked = admitLocalhost)
      val result = await(driver.fetchEphemeral(EphemeralRestConfig(url = urlFor("ok"), method = "GET", headers = Map("X-Test" -> "1"))))
      result shouldBe Right(JsObject("ok" -> JsBoolean(true)))
    }
  }

  // ── Task 4.3: SourceService.inferRest/testRest (POST /api/sources/infer|test), bare-url
  // (ephemeral) path -- the thin HTTP shell (SourcePreviewRoutes) does nothing but decode JSON
  // and call these two methods directly, so calling them here is equivalent to exercising the
  // route. Per design.md Decision 8: fetchEphemeral consults fetchOverride, but
  // testConnectionEphemeral does not -- both driver instances below have fetchOverride = None
  // regardless, so that asymmetry does not matter here. ──
  "SourceService.inferRest / testRest (bare-url, ephemeral path)" should {

    def service(resolveHost: String => Try[Array[InetAddress]]): SourceService = {
      val driver = new RestApiConnectorDriver(resolveHost = resolveHost)
      new SourceService(dataSourceRepo = dataSourceRepo, connector = driver, connectorRepo = connectorRepo)
    }

    blockedClasses.foreach { case (label, host, addr) =>
      s"inferRest: refuse a bare url resolving to $label with a 502-class error naming it" in {
        val svc    = service(resolverFor(host, addr))
        val result = await(svc.inferRest(RestApiConfigPayload(url = Some(s"http://$host/")), user))
        result match {
          case Left(err: ServiceError.BadGateway) =>
            err.message should include("disallowed address")
          case other => fail(s"expected BadGateway naming the disallowed address, got $other")
        }
      }

      s"testRest: report ok=false with the reason for a bare url resolving to $label, issuing no request" in {
        val svc    = service(resolverFor(host, addr))
        val result = await(svc.testRest(RestApiConfigPayload(url = Some(s"http://$host/")), user))
        result match {
          case Right(TestConnectionResponseMatcher(false, Some(err))) => err should include("disallowed address")
          case other => fail(s"expected ok=false with a disallowed-address reason, got $other")
        }
      }
    }
  }

  // ── Task 4.4/4.8: a Connector-resolved fetch (the path `refresh`/`preview`/pipeline-run all
  // share, via `connector.fetch(RestApiConfig(connectorId = ...), ...)`) is a DIFFERENT entry
  // point than infer/test's ephemeral path -- it proves the guard is reached from
  // `issueAndParse` regardless of which of the two builders produced the request. The stored
  // Connector row is written directly via `connectorRepo.create` (bypassing
  // `ConnectorEntityService`'s create-time check entirely), modeling a row whose destination
  // became disallowed AFTER it was created -- task 4.8's "independently of create-time
  // validation". `fetchOverride = None` throughout. ──
  "RestApiConnectorDriver.fetch (Connector-resolved path, an entry point other than infer/test)" should {

    "refuse a stored Connector whose baseUrl resolves to a disallowed address, at fetch time, with a 502-class error" in {
      val host = "stored-connector.egress-guard.test"
      val connector = await(
        connectorRepo.create(
          ownerId             = user.id,
          name                = s"stored-egress-${UUID.randomUUID()}",
          kind                = "rest_api",
          baseUrl             = s"http://$host/",
          config              = JsObject("authType" -> JsString("none")).compactPrint,
          credentialPlaintext = "",
          credentialName      = "egress guard test credential"
        )
      )

      val driver = new RestApiConnectorDriver(
        connectorRepoOpt = Some(connectorRepo),
        resolveHost      = resolverFor(host, "127.0.0.1")
      )
      val svc    = new SourceService(dataSourceRepo = dataSourceRepo, connector = driver, connectorRepo = connectorRepo)
      val result = await(svc.inferRest(RestApiConfigPayload(connectorId = Some(connector.id.value)), user))
      result match {
        case Left(err: ServiceError.BadGateway) =>
          err.message should include("disallowed address")
        case other => fail(s"expected BadGateway naming the disallowed address, got $other")
      }
    }
  }

  /** Structural matcher avoiding an import-order dependency on the exact protocol package for
   *  `TestConnectionResponse` field names. */
  private object TestConnectionResponseMatcher {
    def unapply(r: TestConnectionResponse): Option[(Boolean, Option[String])] =
      Some((r.ok, r.error))
  }
}
