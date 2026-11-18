package com.helio.infrastructure.persistence.pipelines

import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import scala.io.Source

/** HEL-1739 (C15): `upsertDebounce` draws `write_generation` from a new sequence on the privileged pool. A missing GRANT would make
 *  every upsert fail (swallowed by `DataSourceService`'s `.recover`), silently arming nothing in prod while superuser fixtures stay
 *  green, so this proves the grant from the migration chain alone: [[ProductTelemetryDbHarness]] migrates as a NOSUPERUSER
 *  NOBYPASSRLS role with no hand-written grants. */
class AutoRunDebounceWriteGenerationGrantsSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness {

  "helio_privileged, from migrations alone," should {
    "hold USAGE and SELECT on the write-generation sequence" in {
      priv(sql"SELECT has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'USAGE')".as[Boolean].head) shouldBe true
      priv(sql"SELECT has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'SELECT')".as[Boolean].head) shouldBe true
    }
    "be able to draw a value from it (the privilege is usable, not only reported)" in {
      priv(sql"SELECT nextval('pipeline_auto_run_debounce_write_seq')".as[Long].head) should be > 0L
    }

    "get the privilege from V144's own GRANT, not only from V38's default privileges" in {
      // V38's ALTER DEFAULT PRIVILEGES already covers a sequence the migration role creates, so removing the explicit GRANT
      // would not turn the checks above red. Strip the privilege, replay only the GRANT statements of V144, and require it back.
      await(ctx.withUserContext(userA.value)(sqlu"REVOKE ALL ON SEQUENCE pipeline_auto_run_debounce_write_seq FROM helio_privileged"))
      priv(sql"SELECT has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'USAGE')".as[Boolean].head) shouldBe false

      val source = Source.fromResource("db/migration/V144__auto_run_debounce_write_generation.sql")
      val sql = try source.mkString finally source.close()
      val statements = sql.linesIterator.filterNot(_.trim.startsWith("--")).mkString("\n").split(";").map(_.trim).filter(_.startsWith("GRANT"))
      statements should not be empty
      statements.foreach(stmt => await(ctx.withUserContext(userA.value)(sqlu"#$stmt")))

      priv(sql"SELECT has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'USAGE')".as[Boolean].head) shouldBe true
      priv(sql"SELECT has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'SELECT')".as[Boolean].head) shouldBe true
    }
  }
}
