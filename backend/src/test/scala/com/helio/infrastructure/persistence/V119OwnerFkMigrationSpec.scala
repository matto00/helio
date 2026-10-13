package com.helio.infrastructure.persistence

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Paths}
import scala.jdk.CollectionConverters._

/** HEL-1347: the post-V119 behaviour -- the constraints on inserts and what a user delete does -- and the parse of
 *  `docs/user-reference-inventory.md` against the migrated schema. The cleanup and guard scenarios live in
 *  [[V119OwnerFkCleanupSpec]] and [[V119OwnerFkGuardSpec]] (HEL-1433 split); the shared setup in
 *  [[V119MigrationHarness]]. This class keeps its name because `docs/user-reference-inventory.md`,
 *  `RlsOwnerTablesSpec` and `RestSourceConnectorMigrationSpec` cite it for exactly these scenarios.
 */
class V119OwnerFkMigrationSpec extends AnyWordSpec with Matchers with V119MigrationHarness {

  "After V119, inserts and user deletes" should {

    "reject a data source for a non-existent user (23503), with no owner (23502), and an image upload for a non-existent user (23503)" in withDb { (db, c) =>
      flyway(db, Some("119")).migrate()
      def insDs(owner: String) = s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                                    |VALUES ('x', 'x', 'dataset', '{}'::jsonb, now(), now(), $owner)""".stripMargin
      sqlState(c, insDs(s"'$Ghost'")) shouldBe Some("23503")
      sqlState(c, insDs("NULL")) shouldBe Some("23502")
      sqlState(c, s"INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('x', '$Ghost', 'k', 'image/png', 'x.png', 1)") shouldBe Some("23503")
      count(c, "SELECT count(*) FROM data_sources") + count(c, "SELECT count(*) FROM image_uploads") shouldBe 0
    }

    "cascade a user delete to their data sources, dataset rows and image uploads (user owns nothing else)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1), rowCount = 2)
      ds(c, "s2", Some(U2), rowCount = 1)
      image(c, "i1", U1)
      image(c, "i2", U2)
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      ids(c, "data_sources") shouldBe Set("s2")
      ids(c, "dataset_rows") shouldBe Set("s2-r1")
      ids(c, "image_uploads") shouldBe Set("i2")
      userIds(c) shouldBe Set(U2)
    }

    "reject, intact, deleting a user who owns a pipeline (own source, 1-step lane)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s1", Some(U1))
      pipeline(c, "p1", U1)
      root(c, "r1", "p1", "s1", 0)
      rootStep(c, "st1", "p1", "r1")
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'").map(_.take(2)) shouldBe Some("23")
      userIds(c) shouldBe Set(U1)
      ids(c, "data_sources") shouldBe Set("s1")
      ids(c, "pipeline_roots") shouldBe Set("r1")
      ids(c, "pipeline_steps") shouldBe Set("st1")
    }

    "reject, intact, a cascade into another user's pipeline's LAST root (1-step lane; the V99 zero-root guard)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      rootStep(c, "st1", "p2", "r1")
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"cross-owner last root, 1-step lane: SQLSTATE $state")
      state.exists(s => s.startsWith("23") || s == "P0001") shouldBe true
      userIds(c) shouldBe Set(U1, U2)
      ids(c, "data_sources") shouldBe Set("s1")
      ids(c, "pipeline_roots") shouldBe Set("r1")
      ids(c, "pipeline_steps") shouldBe Set("st1")
    }

    "reject, intact, a cascade into a root whose lane has 2+ steps (parent_step_id is NO ACTION)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      ds(c, "s2", Some(U2))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      root(c, "r2", "p2", "s2", 1) // a second root, so the V99 zero-root guard cannot be what rejects it
      rootStep(c, "st1", "p2", "r1")
      childStep(c, "st1b", "p2", "st1")
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"cross-owner root, 2-step lane, second root present: SQLSTATE $state")
      state.exists(_.startsWith("23")) shouldBe true
      userIds(c) shouldBe Set(U1, U2)
      ids(c, "data_sources") shouldBe Set("s1", "s2")
      ids(c, "pipeline_roots") shouldBe Set("r1", "r2")
      ids(c, "pipeline_steps") shouldBe Set("st1", "st1b")
    }

    "silently reach another user's pipeline when the deleted user's source is one of several roots (1-step lane)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      ds(c, "s2", Some(U2))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      root(c, "r2", "p2", "s2", 1)
      rootStep(c, "st1", "p2", "r1")
      stepOutput(c, "o1", "p2", "st1", U2)
      dashboard(c, "d2", U2)
      outputPanel(c, "pn1", "d2", U2, "o1")
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      // The deleted user's source, its root, that root's step, the Output and the bound panel are gone ...
      userIds(c) shouldBe Set(U2)
      ids(c, "data_sources") shouldBe Set("s2")
      ids(c, "pipeline_roots") shouldBe Set("r2")
      ids(c, "pipeline_steps") shouldBe Set.empty[String]
      ids(c, "outputs") shouldBe Set.empty[String]
      ids(c, "panels") shouldBe Set.empty[String]
      // ... while the other user's pipeline, dashboard and remaining root survive.
      ids(c, "pipelines") shouldBe Set("p2")
      ids(c, "dashboards") shouldBe Set("d2")
    }

    "settle a user who owns a connector and its credential (connectors.credential_id is RESTRICT)" in withDb { (db, c) =>
      user(c, U1)
      exec(c, s"""INSERT INTO connector_credentials (id, user_id, name, key_id, wrapped_data_key, nonce_dek, ciphertext, nonce_value)
                 |VALUES ('00000000-0000-0000-0000-0000000000c1', '$U1', 'cred', 'k', '\\x00', '\\x00', '\\x00', '\\x00')""".stripMargin)
      exec(c, s"""INSERT INTO connectors (id, owner_id, name, kind, base_url, credential_id)
                 |VALUES ('00000000-0000-0000-0000-0000000000c2', '$U1', 'conn', 'rest', 'https://example.test', '00000000-0000-0000-0000-0000000000c1')""".stripMargin)
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"user with connector + credential, fresh migrated DB: SQLSTATE $state")
      // Observed outcome on a freshly migrated DB; docs/user-reference-inventory.md records it as order-dependent,
      // not a guarantee (RESTRICT is immediate, so the winner depends on RI trigger firing order).
      state shouldBe CONNECTOR_DELETE_OUTCOME
      if (state.isEmpty) {
        count(c, "SELECT count(*) FROM connectors") + count(c, "SELECT count(*) FROM connector_credentials") shouldBe 0
      } else {
        userIds(c) shouldBe Set(U1)
        count(c, "SELECT count(*) FROM connectors") shouldBe 1
        count(c, "SELECT count(*) FROM connector_credentials") shouldBe 1
      }
    }
  }

  // Observed on a fresh migrated database (see the scenario above and docs/user-reference-inventory.md).
  private val CONNECTOR_DELETE_OUTCOME: Option[String] = None

  "The user-reference inventory document" should {
    "list exactly the foreign keys that reference users in a fully migrated database" in withDb { (db, c) =>
      flyway(db, None).migrate()
      val actual = rows(c,
        """SELECT conrelid::regclass::text, a.attname,
          |       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT'
          |                        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END
          |FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
          |WHERE k.contype = 'f' AND k.confrelid = 'users'::regclass""".stripMargin)(r => (r.getString(1), r.getString(2), r.getString(3))).toSet

      val lines = Files.readAllLines(Paths.get("../docs/user-reference-inventory.md")).asScala.toVector
      val header = lines.indexWhere(_.replaceAll("\\s", "") == "|Table|Column|ONDELETE|")
      withClue("docs/user-reference-inventory.md must contain the `| Table | Column | ON DELETE |` table: ") { header should be >= 0 }
      val documented = lines.drop(header + 2).takeWhile(_.trim.startsWith("|")).map { l =>
        val cells = l.split('|').map(_.trim.stripPrefix("`").stripSuffix("`")).filter(_.nonEmpty)
        (cells(0), cells(1), cells(2))
      }.toSet

      withClue(s"in the database but undocumented: ${actual -- documented}; documented but absent: ${documented -- actual}: ") {
        documented shouldBe actual
      }
      actual should contain(("data_sources", "owner_id", "CASCADE"))
      actual should contain(("image_uploads", "owner_id", "CASCADE"))
    }
  }
}
