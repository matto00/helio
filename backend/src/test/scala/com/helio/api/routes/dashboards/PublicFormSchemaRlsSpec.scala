package com.helio.api.routes.dashboards

import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1587 design D2 (a): the public form-schema read, run with the app pool as a real NOBYPASSRLS role
 *  (`helio_app_test`, the `UpsertTargetWritableRlsSpec` convention). The foreign-dataset case must be `NotFound` from RLS
 *  alone (this is observable only here: the ordinary harness is BYPASSRLS), and the form owner's OWN dataset must be
 *  readable (owner-positive control: the app role can read `data_sources` at all, so the 404 is not a missing grant). */
class PublicFormSchemaRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres            = _
  private var superDb: JdbcBackend.Database   = _
  private var appDb: JdbcBackend.Database     = _
  private var resolver: PublicFormSchemaResolver = _

  private val formOwner  = UUID.randomUUID().toString
  private val otherOwner = UUID.randomUUID().toString

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    superDb = JdbcBackend.Database.forDataSource(pg.getPostgresDatabase, Some(5))
    val conn = pg.getPostgresDatabase.getConnection
    try {
      val st = conn.createStatement()
      st.execute("""DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
                   |CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN; END IF; END $$""".stripMargin)
      st.execute("GRANT helio_app_test TO postgres")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      st.close()
    } finally conn.close()
    val cfg = new HikariConfig()
    cfg.setDataSource(pg.getPostgresDatabase)
    cfg.setMaximumPoolSize(5)
    cfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(5))
    val ctx = new DbContext(appDb, superDb)
    await(superDb.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($formOwner::uuid, ${s"$formOwner@t.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherOwner::uuid, ${s"$otherOwner@t.test"}, now())"""
    )))
    resolver = new PublicFormSchemaResolver(new PanelRepository(ctx), new DataSourceRepository(ctx), None)
  }

  override def afterAll(): Unit = { superDb.close(); pg.close(); super.afterAll() }

  private val schema = """[{"name":"quantity","type":"integer","required":true},{"name":"note","type":"string","required":false},{"name":"extra","type":"string","required":false}]"""

  private def seed(datasetOwner: String, panelOwner: String): (String, String) = {
    val src  = UUID.randomUUID().toString
    val dash = UUID.randomUUID().toString
    val pnl  = UUID.randomUUID().toString
    val cfg  = s"""{"dataSourceId":"$src","fields":[{"sourceField":"quantity","control":"number"},{"sourceField":"note","control":"text"}],"submit":{"writeMode":"append"}}"""
    await(superDb.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($src::uuid, 'ds', 'dataset', '{}'::jsonb, ${datasetOwner}::uuid, now(), now(), $schema::jsonb)""",
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dash, 'D', $formOwner, now(), now(), '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${formOwner}::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
             VALUES ($pnl, $dash, 'F', $panelOwner, now(), now(), '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'form', ${panelOwner}::uuid, $cfg::jsonb)"""
    )))
    (dash, pnl)
  }

  "PublicFormSchemaResolver under a NOBYPASSRLS app pool" should {
    "read the form owner's OWN dataset (owner-positive control)" in {
      val (dash, pnl) = seed(datasetOwner = formOwner, panelOwner = formOwner)
      val result      = await(resolver.resolveFormSchema(dash, pnl))
      result.isRight shouldBe true
      result.toOption.get.fields.map(_.name) shouldBe Vector("quantity", "note")
    }

    "answer NotFound for a dataset the form's owner does not own" in {
      val (dash, pnl) = seed(datasetOwner = otherOwner, panelOwner = formOwner)
      await(resolver.resolveFormSchema(dash, pnl)) shouldBe Left(ServiceError.NotFound("Panel not found"))
    }
  }
}
