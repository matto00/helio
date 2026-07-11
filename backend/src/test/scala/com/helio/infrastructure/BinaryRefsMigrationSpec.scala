package com.helio.infrastructure

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
        "data_type_id",
        "row_index",
        "field_name",
        "storage_key",
        "mime_type",
        "filename",
        "size_bytes",
        "created_at"
      )
    }

    "create an index on data_type_id" in {
      val result = await(
        db.run(
          sql"""SELECT indexname FROM pg_indexes
                WHERE tablename = 'binary_refs' AND indexname = 'idx_binary_refs_data_type_id'"""
            .as[String]
            .headOption
        )
      )
      result shouldBe Some("idx_binary_refs_data_type_id")
    }

    "create a unique index on (data_type_id, row_index, field_name)" in {
      // Exclude the primary key index (also UNIQUE, on `id` alone) so this
      // targets only the composite UNIQUE constraint's backing index.
      val result = await(
        db.run(
          sql"""SELECT indexdef FROM pg_indexes
                WHERE tablename = 'binary_refs'
                  AND indexdef ILIKE '%UNIQUE%'
                  AND indexname <> 'binary_refs_pkey'"""
            .as[String]
            .headOption
        )
      )
      result shouldBe defined
      result.get should include("data_type_id")
      result.get should include("row_index")
      result.get should include("field_name")
    }
  }
}
