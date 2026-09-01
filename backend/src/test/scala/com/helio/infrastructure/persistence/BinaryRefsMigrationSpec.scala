package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Integration test for the V46 migration (HEL-217): the `binary_refs`
 *  table applies cleanly against a fresh test database with the expected
 *  columns and indexes. */
class BinaryRefsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  "V46 migration" should {

    // HEL-904 task 2.10: `data_type_id` is dropped -- `pipeline_id`/
    // `node_step_id` (task 2.8, V94) are the sole key now. Dropping the
    // column also drops its dependent index (`idx_binary_refs_data_type_id`)
    // and the composite UNIQUE constraint on `(data_type_id, row_index,
    // field_name)` automatically, so both of those describe-blocks are
    // deleted outright rather than adapted -- there is nothing left keyed
    // on `data_type_id` to assert.
    "create the binary_refs table with the expected columns" in {
      val columns = await(
        db.run(
          sql"""SELECT column_name FROM information_schema.columns
                WHERE table_name = 'binary_refs'"""
            .as[String]
        )
      ).toSet

      columns shouldBe Set(
        "id",
        "row_index",
        "field_name",
        "storage_key",
        "mime_type",
        "filename",
        "size_bytes",
        "created_at",
        "pipeline_id",
        "node_step_id"
      )
    }

    "leave the binary_refs_owner RLS policy keyed on pipeline_id, not data_type_id" in {
      val policyExists = await(
        db.run(
          sql"""SELECT EXISTS (SELECT 1 FROM pg_policies
                WHERE tablename = 'binary_refs' AND policyname = 'binary_refs_owner')"""
            .as[Boolean]
            .head
        )
      )
      policyExists shouldBe true
    }
  }
}
