package com.helio.domain

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class SqlConnectorSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private var embeddedPostgres: EmbeddedPostgres = _

  override def beforeAll(): Unit =
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

  override def afterAll(): Unit =
    embeddedPostgres.close()

  /** A config that opens successfully against the embedded Postgres instance. `query` is
   *  deliberately invalid SQL — `testConnection` must never send it (Scenario: "SQL testConnection
   *  does not execute the query", spec.md). */
  private def liveConfig(query: String = "NOT VALID SQL AT ALL"): SqlSourceConfig =
    SqlSourceConfig(
      dialect  = "postgresql",
      host     = "localhost",
      port     = embeddedPostgres.getPort,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  private def config(dialect: String, host: String = "localhost", port: Int = 5432) =
    SqlSourceConfig(
      dialect  = dialect,
      host     = host,
      port     = port,
      database = "testdb",
      user     = "user",
      password = "pass",
      query    = "SELECT 1"
    )

  // ── DDL/DML keyword rejection ──────────────────────────────────────────────

  "SqlConnector.checkQuery" should {

    "reject a query containing CREATE (uppercase)" in {
      SqlConnector.checkQuery("CREATE TABLE foo (id INT)").isLeft shouldBe true
    }

    "reject a query containing DROP (uppercase)" in {
      SqlConnector.checkQuery("DROP TABLE foo").isLeft shouldBe true
    }

    "reject a query containing ALTER (uppercase)" in {
      SqlConnector.checkQuery("ALTER TABLE foo ADD COLUMN bar TEXT").isLeft shouldBe true
    }

    "reject a query containing DELETE (uppercase)" in {
      SqlConnector.checkQuery("DELETE FROM foo WHERE id = 1").isLeft shouldBe true
    }

    "reject a query containing INSERT (uppercase)" in {
      SqlConnector.checkQuery("INSERT INTO foo VALUES (1)").isLeft shouldBe true
    }

    "reject a query containing UPDATE (uppercase)" in {
      SqlConnector.checkQuery("UPDATE foo SET bar = 1").isLeft shouldBe true
    }

    "reject a query containing TRUNCATE (uppercase)" in {
      SqlConnector.checkQuery("TRUNCATE TABLE foo").isLeft shouldBe true
    }

    "reject DDL/DML keywords case-insensitively" in {
      SqlConnector.checkQuery("create table foo (id int)").isLeft shouldBe true
      SqlConnector.checkQuery("drop table foo").isLeft shouldBe true
      SqlConnector.checkQuery("Delete From foo").isLeft shouldBe true
    }

    "accept a plain SELECT query" in {
      SqlConnector.checkQuery("SELECT id, name FROM users").isRight shouldBe true
    }

    "not reject SELECT with UPDATE as an embedded substring in a column name (6.2)" in {
      SqlConnector.checkQuery("SELECT updated_at FROM events").isRight shouldBe true
    }

    "not reject SELECT with DELETE as a substring in a column name" in {
      SqlConnector.checkQuery("SELECT deleted_flag FROM records").isRight shouldBe true
    }

    "not reject SELECT with INSERT as a substring in a column name" in {
      SqlConnector.checkQuery("SELECT inserted_by FROM logs").isRight shouldBe true
    }

    "not reject SELECT with TRUNCATE as a table name prefix" in {
      SqlConnector.checkQuery("SELECT truncate_id FROM archive_truncates").isRight shouldBe true
    }
  }

  // ── JDBC URL construction ──────────────────────────────────────────────────

  "SqlConnector.buildJdbcUrl" should {

    "build a PostgreSQL JDBC URL" in {
      val url = SqlConnector.buildJdbcUrl(config("postgresql", "db.example.com", 5433))
      url shouldBe "jdbc:postgresql://db.example.com:5433/testdb"
    }

    "build a MySQL JDBC URL with SSL disabled" in {
      val url = SqlConnector.buildJdbcUrl(config("mysql", "db.example.com", 3306))
      url should startWith("jdbc:mysql://db.example.com:3306/testdb")
      url should include("useSSL=false")
      url should include("allowPublicKeyRetrieval=true")
    }

    "use default port for postgresql when 5432 is specified" in {
      val url = SqlConnector.buildJdbcUrl(config("postgresql", "localhost", 5432))
      url shouldBe "jdbc:postgresql://localhost:5432/testdb"
    }

    "use default port for mysql when 3306 is specified" in {
      val url = SqlConnector.buildJdbcUrl(config("mysql", "localhost", 3306))
      url should startWith("jdbc:mysql://localhost:3306/testdb")
    }
  }

  // ── Schema inference from JDBC rows (HEL-261 regression) ──────────────────

  /** `SqlConnector.inferSchema` is a pure function: it converts a
   *  `Seq[Map[String, JsValue]]` (exactly what `execute` returns) to an
   *  `InferredSchema`. These tests confirm field names come from the map
   *  keys (i.e. JDBC column labels) — no fabrication. */
  "SqlConnector.inferSchema" should {

    "derive field names exclusively from the column keys in the row maps" in {
      val rows = Seq(
        Map("order_id" -> JsNumber(1), "amount" -> JsNumber(BigDecimal("9.99"))),
        Map("order_id" -> JsNumber(2), "amount" -> JsNumber(BigDecimal("14.50")))
      )
      val schema = SqlConnector.inferSchema(rows)
      schema.fields.map(_.name) should contain theSameElementsAs Seq("order_id", "amount")
    }

    "produce exactly as many fields as there are distinct columns — no extras" in {
      val rows = Seq(
        Map("col_a" -> JsString("x"), "col_b" -> JsBoolean(true), "col_c" -> JsNumber(42))
      )
      val schema = SqlConnector.inferSchema(rows)
      schema.fields should have size 3
    }

    "return empty schema for an empty row set" in {
      SqlConnector.inferSchema(Seq.empty).fields shouldBe empty
    }
  }

  // ── SqlConnector as Connector[SqlSourceConfig] (HEL-449 task 4.2) ─────────

  "SqlConnector.metadata" should {
    "expose kind=sql, displayName=SQL Database, supportsIncremental=false, authKind=basic" in {
      val asConnector: Connector[SqlSourceConfig] = SqlConnector
      asConnector.metadata shouldBe ConnectorMetadata(
        kind = "sql",
        displayName = "SQL Database",
        supportsIncremental = false,
        authKind = "basic"
      )
    }
  }

  "SqlConnector.testConnection" should {

    "succeed (open+close only) against a reachable database, even with an unexecutable query" in {
      // liveConfig's query is invalid SQL — if testConnection executed it, this would fail.
      await(SqlConnector.testConnection(liveConfig())) shouldBe Right(())
    }

    "fail with a distinct 'SQL connection failed' message when the database is unreachable" in {
      val unreachable = liveConfig().copy(port = 1)
      await(SqlConnector.testConnection(unreachable)) shouldBe Left("SQL connection failed")
    }
  }

  "SqlConnector.fetch(config, maxRows) via the Connector trait" should {

    "match SqlConnector.toRows(SqlConnector.execute(config, maxRows)) for a real query" in {
      val runnable = liveConfig(query = "SELECT 1 AS one")
      val expected = await(SqlConnector.execute(runnable, maxRows = 100)).map(SqlConnector.toRows)

      val viaTrait = await(SqlConnector.fetch(runnable, maxRows = 100))
      viaTrait shouldBe expected
      viaTrait shouldBe Right(Vector(JsObject("one" -> JsNumber(1))))
    }
  }

  "SqlConnector.inferSchema(config) via the Connector trait" should {

    "derive the same fields SourceService.inferSql would derive from the same query" in {
      val runnable = liveConfig(query = "SELECT 1 AS one, 'x' AS label")
      val rows      = await(SqlConnector.execute(runnable, maxRows = 100)).getOrElse(fail("expected Right"))
      val expected  = SqlConnector.inferSchema(rows)

      val result = await(SqlConnector.inferSchema(runnable))
      result.map(_.fields.map(_.name)) shouldBe Right(expected.fields.map(_.name))
    }
  }
}
