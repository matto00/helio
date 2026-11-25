package com.helio.infrastructure.persistence.sources

import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model.{AuditSource, AuthenticatedUser, DataSourceId, DatasetFieldDeclaration, PanelId, UserId}
import com.helio.domain.panels.{FormFieldSpec, FormPanelConfig, FormSubmission, FormSubmitSpec}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.sources.DataSourceService
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.ActorSystem
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.postgresql.util.PSQLException
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1175: the keyed form-submit append against a real `EmbeddedPostgres` and the real source lock. The
 *  lookup-first path, the stamp, and the unique index as a defence in depth: the index's violation is raised
 *  as a REAL `PSQLException` (lookup bypassed) and only the submit-key constraint is mapped to a conflict. */
class DatasetRowSubmitKeyRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val system: ActorSystem  = ActorSystem("dataset-row-submit-key-spec")
  private implicit val ec: ExecutionContext = system.dispatcher

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var repo: DataSourceRepository         = _

  private val ownerId = UUID.randomUUID().toString
  private val otherId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId), AuditSource.Ui, None)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx  = new DbContext(db, db)(ec)
    repo = new DataSourceRepository(ctx)(ec)
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'key-owner@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'key-other@helio.test', now())"""
    )))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); system.terminate() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private val schemaJson = """[{"name":"quantity","type":"integer","required":true}]"""
  private val config     = FormPanelConfig(DataSourceId("unused"), Vector(FormFieldSpec("quantity", "number", required = Some(true))), FormSubmitSpec.Default)
  private val build: (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
    (decl, now) => FormSubmission.buildRow(config, decl, Map("quantity" -> JsNumber(1)), now)

  private def seedSource(): DataSourceId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($id::uuid, 'k', 'dataset', '{}'::jsonb, ${ownerId}::uuid, now(), now(), $schemaJson::jsonb)"""
    ))
    DataSourceId(id)
  }

  private def seedPanel(): PanelId = {
    val dashboardId = UUID.randomUUID().toString
    val panelId     = UUID.randomUUID().toString
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashboardId, 'd', $ownerId, now(), now(), '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES ($panelId, $dashboardId, 'p', $ownerId, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'text', ${ownerId}::uuid)"""
    )))
    PanelId(panelId)
  }

  private def rowCount(id: DataSourceId): Int =
    await(ctx.withSystemContext(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = ${id.value}".as[Int].head))

  private def stamp(key: UUID, user: String, panel: PanelId) =
    DataSourceRepository.SubmitKeyStamp(key, UserId(user), panel)

  private def keyed(id: DataSourceId, s: DataSourceRepository.SubmitKeyStamp) =
    await(repo.appendBuiltRowKeyed(id, build, 100, Instant.now(), owner, s))

  "appendBuiltRowKeyed" should {
    "append once, then replay the original row for the same key, user and panel" in {
      val id = seedSource(); val panel = seedPanel(); val s = stamp(UUID.randomUUID(), ownerId, panel)
      val first  = keyed(id, s).get.toOption.get
      val second = keyed(id, s).get.toOption.get
      first shouldBe a[DataSourceRepository.KeyedAppend.Appended]
      second shouldBe a[DataSourceRepository.KeyedAppend.Replayed]
      second.row.id shouldBe first.row.id
      rowCount(id) shouldBe 1
    }

    "answer KeyConflict for another user or another panel, writing nothing" in {
      val id = seedSource(); val panel = seedPanel(); val k = UUID.randomUUID()
      keyed(id, stamp(k, ownerId, panel)).get.isRight shouldBe true
      keyed(id, stamp(k, otherId, panel)).get shouldBe Left(DataSourceRepository.FormRowBuildFailure.KeyConflict)
      keyed(id, stamp(k, ownerId, seedPanel())).get shouldBe Left(DataSourceRepository.FormRowBuildFailure.KeyConflict)
      rowCount(id) shouldBe 1
    }

    "treat the same key on a different dataset as a fresh key" in {
      val src1 = seedSource(); val src2 = seedSource(); val panel = seedPanel(); val s = stamp(UUID.randomUUID(), ownerId, panel)
      keyed(src1, s).get.isRight shouldBe true
      keyed(src2, s).get.toOption.get shouldBe a[DataSourceRepository.KeyedAppend.Appended]
    }
  }

  "the unique index, defence in depth" should {
    "raise a real PSQLException the service maps to a conflict, and roll the append back (lookup bypassed)" in {
      val id = seedSource(); val panel = seedPanel(); val s = stamp(UUID.randomUUID(), ownerId, panel)
      keyed(id, s).get.isRight shouldBe true
      val failure = Await.ready(
        ctx.withUserContext(owner.id.value)(repo.appendBuiltRowAction(id, build, 100, Instant.now(), Some(s), lookupFirst = false)),
        20.seconds
      ).value.get.failed.get
      failure shouldBe a[PSQLException]
      DataSourceService.isSubmitKeyConflict(failure) shouldBe true
      rowCount(id) shouldBe 1
    }

    "NOT map a unique violation of another constraint (the per-dataset seq)" in {
      val id = seedSource()
      def insert(rowId: String) = sqlu"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
                                         VALUES ($rowId, ${id.value}, 0, '[1]'::jsonb, now(), now())"""
      await(ctx.withSystemContext(insert(UUID.randomUUID().toString)))
      val failure = Await.ready(ctx.withSystemContext(insert(UUID.randomUUID().toString)), 20.seconds).value.get.failed.get
      failure shouldBe a[PSQLException]
      failure.asInstanceOf[PSQLException].getSQLState shouldBe "23505"
      DataSourceService.isSubmitKeyConflict(failure) shouldBe false
    }

    "NOT map a non-database failure" in {
      DataSourceService.isSubmitKeyConflict(new RuntimeException("x")) shouldBe false
    }
  }
}
