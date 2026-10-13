package com.helio.infrastructure.persistence

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1433: the cleanup half of V119's scenarios -- orphans removed, owned rows kept, FORCE RLS restored; and the
 *  clean-database no-op. Split out of the former single V119OwnerFkMigrationSpec; the harness is [[V119MigrationHarness]]. */
class V119OwnerFkCleanupSpec extends AnyWordSpec with Matchers with V119MigrationHarness {

  "V119, run as a NOSUPERUSER NOBYPASSRLS table-owning role" should {

    "delete orphaned and NULL-owner sources (with their dataset rows) and orphaned images, keep owned rows, and restore FORCE" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-own", Some(U1), rowCount = 3)
      ds(c, "s-orphan", Some(Ghost), rowCount = 2)
      ds(c, "s-null", None, rowCount = 1)
      image(c, "i-own", U1)
      image(c, "i-orphan", Ghost)
      pipeline(c, "p-own", U1)
      root(c, "r-own", "p-own", "s-own", 0)
      rootStep(c, "st-own", "p-own", "r-own")

      noException should be thrownBy flyway(db, Some("119")).migrate()

      ids(c, "data_sources") shouldBe Set("s-own")
      ids(c, "dataset_rows") shouldBe Set("s-own-r1", "s-own-r2", "s-own-r3")
      ids(c, "image_uploads") shouldBe Set("i-own")
      ids(c, "pipeline_roots") shouldBe Set("r-own")
      ids(c, "pipeline_steps") shouldBe Set("st-own")
      assertForceOnEverywhere(c)
      v119Applied(c) shouldBe true
      rows(c, "SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'data_sources'::regclass AND a.attname = 'owner_id'")(_.getBoolean(1)) shouldBe Vector(true)
      rows(c, "SELECT conrelid::regclass::text, confdeltype::text FROM pg_constraint WHERE conname IN ('data_sources_owner_id_fkey', 'image_uploads_owner_id_fkey') ORDER BY 1")(
        r => r.getString(1) -> r.getString(2)) shouldBe Vector("data_sources" -> "c", "image_uploads" -> "c")
    }

    "do nothing on a clean database, and add both constraints" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-own", Some(U1), rowCount = 2)
      image(c, "i-own", U1)

      noException should be thrownBy flyway(db, Some("119")).migrate()

      ids(c, "data_sources") shouldBe Set("s-own")
      ids(c, "dataset_rows").size shouldBe 2
      ids(c, "image_uploads") shouldBe Set("i-own")
      count(c, "SELECT count(*) FROM pg_constraint WHERE conname IN ('data_sources_owner_id_fkey', 'image_uploads_owner_id_fkey')") shouldBe 2
      assertForceOnEverywhere(c)
    }
  }
}
