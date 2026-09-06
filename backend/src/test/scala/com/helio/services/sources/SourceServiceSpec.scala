package com.helio.services.sources


import com.helio.services.ServiceError
import com.helio.api.protocols.sources.{CreateSourceRequest, FieldOverridePayload, RestApiConfigPayload, SqlCreateSourceRequest, SqlInferRequest}
import com.helio.api.protocols.sources.SqlSourceConfigPayload
import com.helio.services.sources.SourceService
import com.helio.domain.connectors.RestApiConnectorDriver
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
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

/** Service-level coverage for HEL-473: `SourceService`'s create/infer/refresh paths now dispatch
 *  through `ConnectorDriver[Config].inferSchema` (the SPI trait method, HEL-449) and the shared
 *  `SchemaInferenceFacade.toDataFields` projection instead of hand-rolling `execute`/`fetch` +
 *  inline inference. These tests confirm the observable output — including the `fetchError`
 *  early-return path and field-override handling — is unchanged after that routing swap
 *  (design.md Decision 3). `previewSql`/`previewRest` are untouched by this ticket and are not
 *  covered here. */
class SourceServiceSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    // HEL-822: SourceService.createRest's bare-url dual-support path now writes a real
    // `connectors`/`connector_credentials` row FK'd to `users` — seed one for `owner` (this
    // spec never needed a real `users` row before HEL-822).
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${s"${owner.value}@sourceservicespec.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_sources RESTART IDENTITY CASCADE"))
  }

  /** A SQL config that queries the embedded Postgres instance itself — same pattern
   *  `SqlConnectorSpec.liveConfig` uses, so `SqlConnectorDriver.execute` runs a real query. */
  private def sqlConfig(query: String): SqlSourceConfigPayload =
    SqlSourceConfigPayload(
      dialect  = "postgresql",
      host     = "localhost",
      port     = embeddedPostgres.getPort,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  /** A `RestApiConnectorDriver` whose response is driven by an in-memory function rather than a real HTTP
   *  request. `RestApiConnectorDriver.inferSchema`/the trait `fetch(config, maxRows)` both delegate to the
   *  single-arg `fetch(config)`, which honors `fetchOverride` (see `RestApiConnectorDriver.scala`), so this
   *  is a faithful unit-level stand-in for both `SourceService`'s SPI-routed calls. */
  private def restConnector(response: Either[String, JsValue]): RestApiConnectorDriver =
    new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(response)))

  // HEL-952 task 8.1b: admits this spec's known-safe "localhost" SQL host past the egress guard
  // (real, unmodified isBlockedAddress for every other host) — repairs the createSql/inferSql/
  // refresh(SQL) coverage below now that SqlConnectorDriver.connect enforces the guard.
  private val admitLocalhostSql: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  private def service(connector: RestApiConnectorDriver): SourceService =
    new SourceService(dataSourceRepo, connector, connectorRepo = connectorRepo, sqlIsBlocked = admitLocalhostSql)

  // HEL-952 skeptic-final-1 CR1: a fake resolver mapping one synthetic hostname per blocked
  // class to a real disallowed address, `isBlocked` left as the REAL default denylist —
  // mirrors `RestConnectorEgressGuardSpec.resolverFor` exactly. Used only by the create-time
  // rejection block below, never by the "still works" tests above (which rely on
  // admitLocalhostSql + real DNS for "localhost").
  private def resolverFor(host: String, addr: String): String => Try[Array[InetAddress]] =
    h => if (h == host) Success(Array(InetAddress.getByName(addr))) else ContentSourceSupport.defaultResolveHost(h)

  private def serviceWithSqlResolver(resolveHost: String => Try[Array[InetAddress]]): SourceService =
    new SourceService(dataSourceRepo, restConnector(Right(JsArray())), connectorRepo = connectorRepo, sqlResolveHost = resolveHost)

  private def sourceCount(): Int = await(dataSourceRepo.findAll(owner, Page(offset = 0, limit = 1000))).total

  private val restConfigPayload =
    RestApiConfigPayload(url = Some("http://example.invalid/data"), method = Some("GET"), auth = None, headers = None)


  "SourceService.createSql" should {

    "create the DataType with fields derived via the shared projection when the query succeeds" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("Numbers", DataSourceKind.Sql, sqlConfig("SELECT 1 AS one, 'x' AS label"))

      val result = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }

      result.fetchError shouldBe None
      val schema = result.inferredSchema.getOrElse(fail("expected an inferred schema")).fields
      schema.map(_.name) should contain theSameElementsAs Seq("one", "label")
      schema.find(_.name == "one").get.dataType   shouldBe "integer"
      schema.find(_.name == "label").get.dataType shouldBe "string"
    }

    "surface fetchError (not fail the request) and infer no schema when the query fails" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("Broken", DataSourceKind.Sql, sqlConfig("SELECT * FROM definitely_not_a_real_table"))

      val result = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }

      result.fetchError shouldBe defined
      result.inferredSchema shouldBe None
    }

    // HEL-952 skeptic-final-1 CR1: the create-time guard (design.md Decision 3) is the ONLY
    // thing standing between AC1's "cannot be created" and a 200-with-fetchError that silently
    // persists a row pointed at a blocked address — SqlConnectorEgressGuardSpec's
    // `checkConfigEgress` matrix never touches `SourceService`/`DataSourceRepository`, so
    // without this block the create-time guard had zero coverage. One synthetic hostname per
    // blocked class, via `resolverFor` (real `isBlocked` denylist, fake resolver) — mirrors
    // `RestConnectorEgressGuardSpec`'s "reject a baseUrl resolving to ..., persisting nothing"
    // block exactly, at the SQL create path instead of the Connector create path.
    Seq(
      "loopback"                     -> ("sql-loopback.egress-guard.test", "127.0.0.1"),
      "link-local (cloud metadata)"   -> ("sql-metadata.egress-guard.test", "169.254.169.254"),
      "RFC1918 private"               -> ("sql-private.egress-guard.test", "10.0.0.5"),
      "IPv6 unique-local"             -> ("sql-uniquelocal.egress-guard.test", "fd00::1")
    ).foreach { case (label, (host, addr)) =>
      s"reject createSql for a host resolving to $label with BadRequest, persisting nothing" in {
        cleanDb()
        val svc     = serviceWithSqlResolver(resolverFor(host, addr))
        val before  = sourceCount()
        val request = SqlCreateSourceRequest("Blocked", DataSourceKind.Sql, sqlConfig("SELECT 1").copy(host = host))

        val result = await(svc.createSql(request, user))

        result shouldBe a[Left[_, _]]
        result.left.toOption.get shouldBe a[ServiceError.BadRequest]
        sourceCount() shouldBe before
      }
    }

    // HEL-952 skeptic-final-2 non-blocking item 3: deliberately does NOT use a fake-resolved
    // real public address here (an earlier draft resolved a synthetic hostname to a real IP,
    // which meant a real outbound JDBC connect attempt in CI). `admitLocalhostSql` + real DNS
    // for the literal "localhost" hostname proves exactly the same thing — the create-time gate
    // allows a permitted host — without depending on network reachability to an address this
    // process doesn't control, and the point of this test is only that the gate does not
    // reject, not that any particular address is reachable.
    "still create the source for a host the isBlocked override admits (a permitted host)" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("Permitted", DataSourceKind.Sql, sqlConfig("SELECT 1"))

      val result = await(svc.createSql(request, user))

      result shouldBe a[Right[_, _]]
    }
  }


  "SourceService.createRest" should {

    "create the DataType with override-aware fields when the fetch succeeds" in {
      cleanDb()
      val json: JsValue = JsArray(
        JsObject("id" -> JsNumber(1), "label" -> JsString("a")),
        JsObject("id" -> JsNumber(2), "label" -> JsString("b"))
      )
      val svc       = service(restConnector(Right(json)))
      val overrides = Vector(FieldOverridePayload(name = "label", displayName = "Label Override", dataType = "string"))
      val request   = CreateSourceRequest("Widgets", DataSourceKind.RestApi, restConfigPayload, Some(overrides))

      val result = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      result.fetchError shouldBe None
      val schema = result.inferredSchema.getOrElse(fail("expected an inferred schema")).fields
      schema.find(_.name == "id").get.dataType shouldBe "integer"
      val labelField = schema.find(_.name == "label").get
      labelField.displayName shouldBe "Label Override"
      labelField.dataType    shouldBe "string"
    }

    "surface fetchError and infer no schema when the fetch fails" in {
      cleanDb()
      val svc     = service(restConnector(Left("Request failed")))
      val request = CreateSourceRequest("Broken", DataSourceKind.RestApi, restConfigPayload, None)

      val result = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      result.fetchError shouldBe Some("Request failed")
      result.inferredSchema shouldBe None
    }

    // ── HEL-826 task 2.3: immediate 400 on a GET+body create, both dual-support branches ──

    "reject a GET+body request immediately with a BadRequest via the bare-url branch, without persisting an orphaned implicit Connector" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val payload = restConfigPayload.copy(method = Some("GET"), body = Some("""{"a":1}"""))
      val request = CreateSourceRequest("BadBody", DataSourceKind.RestApi, payload, None)

      val countBefore = await(connectorRepo.findAll(user)).size
      val result      = await(svc.createRest(request, user))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadRequest]

      // HEL-826 evaluation-1.md cycle-2 CR1 regression: the rejectBodyOnSafeMethod check runs
      // BEFORE connectorRepo.create in the bare-url branch, so a rejected create must leave no
      // implicit Connector row behind.
      val countAfter = await(connectorRepo.findAll(user)).size
      countAfter shouldBe countBefore
    }

    "reject a GET+body request immediately with a BadRequest via the connectorId branch" in {
      cleanDb()
      val connector = await(connectorRepo.create(
        ownerId = owner, name = s"src-svc-conn-${UUID.randomUUID()}", kind = "rest_api", baseUrl = "http://example.invalid",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val svc     = service(restConnector(Right(JsArray())))
      val payload = RestApiConfigPayload(connectorId = Some(connector.id.value), method = Some("GET"), body = Some("""{"a":1}"""))
      val request = CreateSourceRequest("BadBody2", DataSourceKind.RestApi, payload, None)

      val result = await(svc.createRest(request, user))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadRequest]
    }

    // ── HEL-845 task 1.1/2.7: reject a REST source created against a mismatched-kind Connector ──

    "reject a connectorId create when the referenced Connector is a 'sql' Connector, naming both kinds" in {
      cleanDb()
      val connector = await(connectorRepo.create(
        ownerId = owner, name = s"mismatched-sql-${UUID.randomUUID()}", kind = "sql", baseUrl = "http://example.invalid",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val svc     = service(restConnector(Right(JsArray())))
      val payload = RestApiConfigPayload(connectorId = Some(connector.id.value), method = Some("GET"))
      val request = CreateSourceRequest("Mismatched", DataSourceKind.RestApi, payload, None)

      val result = await(svc.createRest(request, user))
      result.isLeft shouldBe true
      val err = result.left.getOrElse(fail("expected Left")) match {
        case bad: ServiceError.BadRequest => bad
        case other                        => fail(s"expected BadRequest, got $other")
      }
      err.message should include("rest_api")
      err.message should include("sql")
    }

    "still create the source when the referenced Connector is a matching 'rest_api' Connector, returning the bound connectorId" in {
      cleanDb()
      val connector = await(connectorRepo.create(
        ownerId = owner, name = s"matching-rest-${UUID.randomUUID()}", kind = "rest_api", baseUrl = "http://example.invalid",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val svc     = service(restConnector(Right(JsArray())))
      val payload = RestApiConfigPayload(connectorId = Some(connector.id.value), method = Some("GET"))
      val request = CreateSourceRequest("Matching", DataSourceKind.RestApi, payload, None)

      val result = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      // HEL-590 lesson: a status/Right assertion alone is not enough -- assert on the
      // actually-returned content (the bound connectorId), not merely that creation succeeded.
      val stored = await(dataSourceRepo.findAll(owner, Page(offset = 0, limit = 10))).items
        .collectFirst { case r: RestSource => r }
        .getOrElse(fail("expected a stored RestSource"))
      stored.config.connectorId shouldBe connector.id.value
      result.fetchError shouldBe None
    }

    "return the existing curated 'Connector not found' for an unresolvable connectorId, not a kind-mismatch message" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val payload = RestApiConfigPayload(connectorId = Some(UUID.randomUUID().toString), method = Some("GET"))
      val request = CreateSourceRequest("Unresolvable", DataSourceKind.RestApi, payload, None)

      val result = await(svc.createRest(request, user))
      result.isLeft shouldBe true
      val err = result.left.getOrElse(fail("expected Left")) match {
        case bad: ServiceError.BadRequest => bad
        case other                        => fail(s"expected BadRequest, got $other")
      }
      err.message should include("not found")
      err.message should not include "rest_api Connector"
    }

    "fail closed when connectorRepo is null and a connectorId is supplied" in {
      cleanDb()
      val svcNoRepo = new SourceService(dataSourceRepo, restConnector(Right(JsArray())))
      val payload   = RestApiConfigPayload(connectorId = Some(UUID.randomUUID().toString), method = Some("GET"))
      val request   = CreateSourceRequest("NoRepo", DataSourceKind.RestApi, payload, None)

      val result = await(svcNoRepo.createRest(request, user))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadRequest]
    }

    "the bare-url branch still synthesizes its own rest_api Connector without acquiring a kind-mismatch failure" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = CreateSourceRequest("BareUrlStillWorks", DataSourceKind.RestApi, restConfigPayload, None)

      val result = await(svc.createRest(request, user))
      result shouldBe a[Right[_, _]]
    }
  }


  "SourceService.inferSql" should {

    "return the inferred schema for a successful query" in {
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlInferRequest(DataSourceKind.Sql, sqlConfig("SELECT 1 AS one, 'x' AS label"))

      val schema = await(svc.inferSql(request)).getOrElse(fail("expected Right"))
      schema.fields.map(_.name) should contain theSameElementsAs Seq("one", "label")
    }

    "return a BadGateway ServiceError when the query fails" in {
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlInferRequest(DataSourceKind.Sql, sqlConfig("SELECT * FROM definitely_not_a_real_table"))

      val result = await(svc.inferSql(request))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadGateway]
    }
  }

  "SourceService.inferRest" should {

    "return the inferred schema for a successful fetch" in {
      val json: JsValue = JsObject("id" -> JsNumber(1), "active" -> JsBoolean(true))
      val svc            = service(restConnector(Right(json)))

      val schema = await(svc.inferRest(restConfigPayload, user)).getOrElse(fail("expected Right"))
      schema.fields.map(_.name) should contain theSameElementsAs Seq("id", "active")
    }

    "return a BadGateway ServiceError carrying the connector's error message when the fetch fails" in {
      val svc    = service(restConnector(Left("Request failed")))
      val result = await(svc.inferRest(restConfigPayload, user))
      result shouldBe Left(ServiceError.BadGateway("Request failed"))
    }
  }


  // HEL-904: refresh now re-writes `data_sources.inferred_schema` directly — there is no
  // companion DataType row and no version concept to bump; refresh is a plain in-place upsert.
  "SourceService.refresh (SQL)" should {

    "re-infer the schema onto the source's inferredSchema column" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("RefreshMe", DataSourceKind.Sql, sqlConfig("SELECT 1 AS one"))
      val created = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(ds) => ds
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.inferredSchema.map(_.name) shouldBe Seq("one")
    }
  }

  "SourceService.refresh (REST)" should {

    "re-infer the schema onto the source's inferredSchema column" in {
      cleanDb()
      val json: JsValue = JsArray(JsObject("id" -> JsNumber(1)))
      val svc            = service(restConnector(Right(json)))
      val request        = CreateSourceRequest("RefreshRest", DataSourceKind.RestApi, restConfigPayload, None)
      val created = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(ds) => ds
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.inferredSchema.map(_.name) shouldBe Seq("id")
    }
  }

  // ── HEL-599 design.md D6 / task 5.9: previewRest agrees with the advertised schema + rows ──

  "SourceService.preview (REST)" should {

    "returns flat dotted keys for a nested response, matching the advertised schema" in {
      cleanDb()
      val json: JsValue = JsArray(
        JsObject("player_id" -> JsString("8800"), "stats" -> JsObject("pts_ppr" -> JsNumber(33.7)))
      )
      val svc     = service(restConnector(Right(json)))
      val created = await(svc.createRest(CreateSourceRequest("PreviewNested", DataSourceKind.RestApi, restConfigPayload, None), user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val schema = created.inferredSchema.getOrElse(fail("expected an inferred schema")).fields
      schema.map(_.name) should contain("stats.pts_ppr")

      val previewed = await(svc.preview(DataSourceId(created.source.id), user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"preview failed: $e")
      }
      previewed.rows should have size 1
      val row = previewed.rows.head.asInstanceOf[JsObject]
      row.fields should contain key "stats.pts_ppr"
      row.fields should not contain key("stats")
    }

    "surfaces a broken rootSelector as BadGateway, not a 200 with zero rows" in {
      cleanDb()
      val json: JsValue = JsObject("data" -> JsArray(JsObject("id" -> JsNumber(1))))
      val svc     = service(restConnector(Right(json)))
      val payload = restConfigPayload.copy(rootSelector = Some("nope"))
      val created = await(svc.createRest(CreateSourceRequest("PreviewBadSelector", DataSourceKind.RestApi, payload, None), user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      val result = await(svc.preview(DataSourceId(created.source.id), user))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadGateway]
    }
  }
}
