package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DbContext}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.JsValue

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Config for [[EnvelopeFixtureConnector]] — a fixture distinct from `NewConnectorInferenceSpec`'s
 *  `RowSupplyingConnector` (which only ever succeeds), built specifically to prove HEL-468's
 *  documented contract (`Connector.scala`'s `'''Fetch-error envelope'''` doc block, spec.md's "A new
 *  connector gets the envelope by construction" requirement): any `Connector[Config]` implementation
 *  — including one with no create-path-specific code of its own — gets a correct
 *  `CreateSourceResponse` (success and failure) for free via `CreateSourceEnvelope.build`, driven
 *  entirely off its `inferSchema` result. */
final case class EnvelopeFixtureConfig(result: Either[String, InferredSchema])

object EnvelopeFixtureConnector extends Connector[EnvelopeFixtureConfig] {

  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "envelope-fixture",
    displayName = "Envelope Fixture Connector",
    supportsIncremental = false,
    authKind = "none"
  )

  def testConnection(config: EnvelopeFixtureConfig)(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    Future.successful(Right(()))

  def fetch(config: EnvelopeFixtureConfig, maxRows: Int)(implicit ec: ExecutionContext): Future[Either[String, Vector[JsValue]]] =
    Future.successful(Right(Vector.empty))

  def inferSchema(config: EnvelopeFixtureConfig)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    Future.successful(config.result)
}

/** Service-level coverage for HEL-468: `CreateSourceEnvelope.build` driven directly against a
 *  test-connector fixture, proving the envelope helper works for any `Connector[Config]`
 *  implementation — not just `SqlConnector`/`RestApiConnector` — with no per-connector envelope
 *  code required. `SourceServiceSpec`'s `createSql`/`createRest` tests (unmodified by this ticket)
 *  are the byte-identical-output signal for the two existing call sites; this spec is the "new
 *  connector gets the envelope by construction" signal. */
class CreateSourceEnvelopeSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataSourceRepo: DataSourceRepository = _

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
    dataTypeRepo   = new DataTypeRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  private def insertedSource(name: String): RestSource = {
    val now = Instant.now()
    val source = RestSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = name,
      ownerId   = user.id,
      createdAt = now,
      updatedAt = now,
      config    = RestApiConfig(url = "http://example.invalid/data", method = "GET")
    )
    await(dataSourceRepo.insert(source, user)).asInstanceOf[RestSource]
  }

  "CreateSourceEnvelope.build" should {

    "produce dataType = None and fetchError = Some(err) verbatim when the connector's inferSchema fails" in {
      cleanDb()
      val inserted = insertedSource("Broken Fixture")
      val config   = EnvelopeFixtureConfig(Left("fixture unreachable"))

      val result = await(CreateSourceEnvelope.build(EnvelopeFixtureConnector, config, inserted, Instant.now(), dataTypeRepo, user))

      result.dataType shouldBe None
      result.fetchError shouldBe Some("fixture unreachable")
    }

    "persist a DataType and return fetchError = None when the connector's inferSchema succeeds" in {
      cleanDb()
      val inserted = insertedSource("Working Fixture")
      val schema = InferredSchema(Seq(
        InferredField(name = "sku", displayName = "sku", dataType = DataFieldType.StringType, nullable = false),
        InferredField(name = "qty", displayName = "qty", dataType = DataFieldType.IntegerType, nullable = false)
      ))
      val config = EnvelopeFixtureConfig(Right(schema))

      val result = await(CreateSourceEnvelope.build(EnvelopeFixtureConnector, config, inserted, Instant.now(), dataTypeRepo, user))

      result.fetchError shouldBe None
      val dt = result.dataType.getOrElse(fail("expected a DataType"))
      dt.fields.map(_.name) should contain theSameElementsAs Seq("sku", "qty")
      dt.fields.find(_.name == "sku").get.dataType shouldBe "string"
      dt.fields.find(_.name == "qty").get.dataType shouldBe "integer"

      val persisted = await(dataTypeRepo.findBySourceId(inserted.id, owner))
      persisted.map(_.fields.map(_.name)) shouldBe Seq(Seq("sku", "qty"))
    }
  }
}
