package com.helio.infrastructure.persistence.pipelines

import com.helio.testsupport.ProductTelemetryDbHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

/** HEL-1652 D6: root add/remove are the first privileged-pool writes to `pipeline_roots`. `TwoUserRlsApiFixture` grants
 *  `helio_privileged` write access on ALL tables by hand, which would hide a missing grant, so this proves it from the migration
 *  chain alone: [[ProductTelemetryDbHarness]] migrates as a NOSUPERUSER NOBYPASSRLS role with no hand-written grants. */
class PipelineRootWriteGrantsSpec extends AnyWordSpec with Matchers with ProductTelemetryDbHarness {

  private def has(table: String, privilege: String): Boolean =
    priv(sql"SELECT has_table_privilege('helio_privileged', $table, $privilege)".as[Boolean].head)

  "helio_privileged, from migrations alone," should {
    "write pipeline_roots (the add insert and position compaction, the remove delete)" in {
      has("pipeline_roots", "INSERT") shouldBe true
      has("pipeline_roots", "UPDATE") shouldBe true
      has("pipeline_roots", "DELETE") shouldBe true
    }
    "delete pipeline_steps and node_snapshots (the remove cascade)" in {
      has("pipeline_steps", "DELETE") shouldBe true
      has("node_snapshots", "DELETE") shouldBe true
    }
    "update data_sources (the add chain's FOR KEY SHARE row lock needs UPDATE or SELECT FOR KEY SHARE)" in {
      has("data_sources", "UPDATE") shouldBe true
    }
  }
}
