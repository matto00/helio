package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** Unit tests for the [[DataSource]] ADT.
 *
 *  Verifies that each subtype carries the correct `kind` discriminator and
 *  that pattern matching is exhaustive across the 4 cases. These are
 *  intentionally tiny — repository round-trip is covered by
 *  `DataSourceRepositorySpec`, and JSON wire shape is covered by
 *  `AggregatorRegressionSpec`. */
class DataSourceSpec extends AnyWordSpec with Matchers {

  private val now    = Instant.parse("2026-05-14T00:00:00Z")
  private val owner  = UserId("00000000-0000-0000-0000-000000000001")
  private val id     = DataSourceId("ds-1")

  "DataSource ADT" should {

    "CsvSource carries kind 'csv'" in {
      val ds: DataSource = CsvSource(id, "csv-src", owner, now, now, CsvSourceConfig("uploads/test.csv"))
      ds.kind shouldBe "csv"
    }

    "RestSource carries kind 'rest_api'" in {
      val ds: DataSource = RestSource(id, "rest-src", owner, now, now,
        RestApiConfig(url = "https://example.test", method = "GET"))
      ds.kind shouldBe "rest_api"
    }

    "SqlSource carries kind 'sql'" in {
      val ds: DataSource = SqlSource(id, "sql-src", owner, now, now,
        SqlSourceConfig("postgresql", "host", 5432, "db", "u", "p", "SELECT 1"))
      ds.kind shouldBe "sql"
    }

    "StaticSource carries kind 'static'" in {
      val ds: DataSource = StaticSource(id, "static-src", owner, now, now)
      ds.kind shouldBe "static"
    }

    "exhaustive pattern matching covers all 4 subtypes" in {
      def describe(ds: DataSource): String = ds match {
        case c: CsvSource    => s"csv:${c.config.path}"
        case r: RestSource   => s"rest:${r.config.url}"
        case s: SqlSource    => s"sql:${s.config.query}"
        case _: StaticSource => "static"
      }
      describe(CsvSource(id, "n", owner, now, now, CsvSourceConfig("p")))                                              shouldBe "csv:p"
      describe(RestSource(id, "n", owner, now, now, RestApiConfig(url = "u")))                                          shouldBe "rest:u"
      describe(SqlSource(id, "n", owner, now, now, SqlSourceConfig("pg", "h", 1, "d", "u", "pw", "Q")))                  shouldBe "sql:Q"
      describe(StaticSource(id, "n", owner, now, now))                                                                  shouldBe "static"
    }
  }

  "DataSourceKind" should {

    "round-trip valid kind strings via parseKind" in {
      DataSourceKind.parseKind("csv")      shouldBe Right("csv")
      DataSourceKind.parseKind("rest_api") shouldBe Right("rest_api")
      DataSourceKind.parseKind("sql")      shouldBe Right("sql")
      DataSourceKind.parseKind("static")   shouldBe Right("static")
    }

    "reject unknown kind strings" in {
      DataSourceKind.parseKind("unknown") should matchPattern { case Left(_) => }
    }
  }
}
