package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SqlConnectorSpec extends AnyWordSpec with Matchers {

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
}
