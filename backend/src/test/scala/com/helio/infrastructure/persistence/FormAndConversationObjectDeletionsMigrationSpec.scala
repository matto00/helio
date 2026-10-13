package com.helio.infrastructure.persistence

import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.{Connection, DriverManager, ResultSet}
import java.util.concurrent.atomic.AtomicInteger

/** HEL-1530: V132's `dataset_rows` / `assistant_conversations` / TRUNCATE triggers under real RLS, mirroring
 *  [[StoredObjectDeletionsMigrationSpec]].
 *
 *  V132 is applied by `helio_migration_test`, a LOGIN NOSUPERUSER NOBYPASSRLS role that OWNS the schema and tables
 *  (prod's Flyway role shape), and every mutation runs on a connection of that same role -- FORCE ROW LEVEL SECURITY
 *  applies to it. Everything is READ over the superuser connection. The proof that matters is that the user's OWN
 *  statement commits (a trigger that cannot write the RLS-locked queue would abort it) and the keys are queued as
 *  new-style rows (`claimed_at = 'infinity'`, `not_before` set) that V128-era claim SQL can never claim.
 *
 *  Mutations (each run by editing V132, shown red, reverted): drop SECURITY DEFINER from a function; skip its
 *  `OWNER TO helio_privileged` re-own. */
class FormAndConversationObjectDeletionsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private val Role     = "helio_migration_test"
  private val Template = "tpl126"
  private val dbSeq    = new AtomicInteger(0)

  private lazy val pg: EmbeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

  override def beforeAll(): Unit = {
    val su = superConn("postgres")
    try {
      exec(su, s"CREATE ROLE $Role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      exec(su, "CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      exec(su, s"GRANT helio_privileged TO $Role WITH ADMIN OPTION")
      exec(su, s"CREATE DATABASE $Template")
      rows(su, s"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '$Role'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
    } finally su.close()
    val tc = superConn(Template)
    try {
      exec(tc, s"ALTER SCHEMA public OWNER TO $Role")
      exec(tc, s"GRANT CREATE, USAGE ON SCHEMA public TO $Role")
    } finally tc.close()
    flyway(Template, Some("126")).migrate()
  }

  override def afterAll(): Unit = pg.close()

  private def superConn(db: String): Connection = pg.getDatabase("postgres", db).getConnection
  private def roleConn(db: String): Connection  = DriverManager.getConnection(pg.getJdbcUrl(Role, db), Role, "test")
  private def flyway(db: String, target: Option[String]): Flyway = {
    val b = Flyway.configure().dataSource(pg.getJdbcUrl(Role, db), Role, "test").locations("classpath:db/migration")
    target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
    b.load()
  }
  private def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  private def exec(c: Connection, sql: String): Int = { val st = c.createStatement(); try { st.execute(sql); st.getUpdateCount } finally st.close() }

  private def withMigratedDb[T](body: (Connection, String) => T): T = {
    val db = s"v132_${dbSeq.incrementAndGet()}"
    val su = superConn("postgres")
    try exec(su, s"CREATE DATABASE $db TEMPLATE $Template") finally su.close()
    flyway(db, None).migrate()
    val c = superConn(db)
    try body(c, db) finally c.close()
  }

  private val U1 = "00000000-0000-0000-0000-0000000000c1"
  private val U2 = "00000000-0000-0000-0000-0000000000c2"

  private def formKey(n: Int): String = f"form-uploads/00000000-0000-4000-8000-${n}%012d.pdf"
  private def cell(key: String): String = s"""{"storageKey":"$key","mimeType":"application/pdf","filename":"a.pdf","sizeBytes":1}"""

  /** u1/u2 each own a dataset source `ds-<k>` with two rows: row `r-<k>-a` holds form key 1/2, row `r-<k>-b` nothing. */
  private def seed(c: Connection): Unit = {
    Seq(U1 -> 1, U2 -> 2).foreach { case (u, n) =>
      exec(c, s"INSERT INTO users (id, email) VALUES ('$u', 'u-$u@example.test')")
      exec(c, s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                 |VALUES ('ds-$n', 'ds', 'dataset', '{}'::jsonb, now(), now(), '$u')""".stripMargin)
      exec(c, s"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
                 |VALUES ('r-$n-a', 'ds-$n', 1, '[1, ${cell(formKey(n))}]'::jsonb, now(), now()),
                 |       ('r-$n-b', 'ds-$n', 2, '[2, null]'::jsonb, now(), now())""".stripMargin)
    }
  }

  private def queueKeys(c: Connection): Set[String] = rows(c, "SELECT storage_key FROM stored_object_deletions")(_.getString(1)).toSet

  /** Runs `body` as the RLS-bound app session of `user` in one committed transaction. */
  private def asUser(db: String, user: String)(body: Connection => Unit): Unit = {
    val app = roleConn(db)
    try {
      app.setAutoCommit(false)
      exec(app, s"SELECT set_config('app.current_user_id', '$user', true)")
      body(app)
      app.commit()
    } finally app.close()
  }

  private def asOwnerNoContext(db: String)(body: Connection => Unit): Unit = {
    val app = roleConn(db)
    try body(app) finally app.close()
  }

  "V132 (applied as a NOSUPERUSER NOBYPASSRLS owner role)" should {

    "pin every function's posture and ENABLE ALWAYS on every trigger" in withMigratedDb { (su, _) =>
      val fns = rows(su, """SELECT p.proname, p.prosecdef, r.rolname, p.proconfig::text
                           |FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                           |WHERE p.proname LIKE 'hel1530\_%' ORDER BY p.proname""".stripMargin)(r => (r.getString(1), r.getBoolean(2), r.getString(3), r.getString(4)))
      fns.map(_._1) shouldBe Vector(
        "hel1530_enqueue_conversation_object", "hel1530_enqueue_dataset_row_delete", "hel1530_enqueue_dataset_row_update",
        "hel1530_truncate_conversations", "hel1530_truncate_data_sources", "hel1530_truncate_dataset_rows", "hel1530_truncate_image_uploads"
      )
      fns.foreach { case (_, secDef, owner, cfg) =>
        secDef shouldBe true
        owner shouldBe "helio_privileged"
        cfg should (include("row_security=off") and include("search_path=pg_catalog, public"))
      }
      // no EXCEPTION block anywhere (a subtransaction per call; design.md D2)
      rows(su, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'hel1530\\_%' AND upper(prosrc) LIKE '%EXCEPTION%'")(_.getInt(1)) shouldBe Vector(0)
      val trig = rows(su, "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'hel1530\\_%' ORDER BY tgname")(r => (r.getString(1), r.getString(2)))
      trig should have size 7
      trig.map(_._2).toSet shouldBe Set("A")
      rows(su, "SELECT count(*) FROM pg_policies WHERE tablename = 'stored_object_deletions'")(_.getInt(1)) shouldBe Vector(0)
    }

    "commit an RLS-bound user's own dataset-row delete and queue the form key as an unclaimable new-style row" in withMigratedDb { (su, db) =>
      seed(su)
      asUser(db, U1)(app => exec(app, "DELETE FROM dataset_rows WHERE id = 'r-1-a'") shouldBe 1)
      rows(su, "SELECT count(*) FROM dataset_rows WHERE id = 'r-1-a'")(_.getInt(1)) shouldBe Vector(0)
      rows(su, "SELECT storage_key, source_table, claimed_at = 'infinity', not_before IS NOT NULL, attempts FROM stored_object_deletions")(
        r => (r.getString(1), r.getString(2), r.getBoolean(3), r.getBoolean(4), r.getInt(5))
      ) shouldBe Vector((formKey(1), "dataset_rows", true, true, 0))
    }

    "commit a dataset-source delete (cascade over its rows) and queue each distinct key once" in withMigratedDb { (su, db) =>
      seed(su)
      exec(su, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('r-1-c', 'ds-1', 3, '[3, ${cell(formKey(1))}]'::jsonb, now(), now())")
      asUser(db, U1)(app => exec(app, "DELETE FROM data_sources WHERE id = 'ds-1'") shouldBe 1)
      rows(su, "SELECT count(*) FROM dataset_rows WHERE data_source_id = 'ds-1'")(_.getInt(1)) shouldBe Vector(0)
      rows(su, "SELECT storage_key FROM stored_object_deletions")(_.getString(1)) shouldBe Vector(formKey(1))
    }

    "commit DELETE FROM users with app.current_user_id unset and queue the cascaded dataset-row keys" in withMigratedDb { (su, db) =>
      seed(su)
      asOwnerNoContext(db)(app => exec(app, s"DELETE FROM users WHERE id = '$U2'") shouldBe 1)
      rows(su, s"SELECT count(*) FROM users WHERE id = '$U2'")(_.getInt(1)) shouldBe Vector(0)
      queueKeys(su) shouldBe Set(formKey(2))
    }

    "queue only the keys an UPDATE removes, never one the row still holds" in withMigratedDb { (su, db) =>
      seed(su)
      val k2 = formKey(9)
      exec(su, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('r-1-two', 'ds-1', 3, '[3, ${cell(formKey(1))}, ${cell(k2)}]'::jsonb, now(), now())")
      // r-1-two keeps its first file but drops the second; r-1-a replaces its file with a different one.
      asUser(db, U1) { app =>
        exec(app, s"UPDATE dataset_rows SET data = '[3, ${cell(formKey(1))}, null]'::jsonb WHERE id = 'r-1-two'") shouldBe 1
      }
      queueKeys(su) shouldBe Set(k2)
      exec(su, "DELETE FROM stored_object_deletions")
      asUser(db, U1) { app =>
        exec(app, s"UPDATE dataset_rows SET data = '[1, ${cell(formKey(7))}]'::jsonb WHERE id = 'r-1-a'") shouldBe 1
      }
      queueKeys(su) shouldBe Set(formKey(1))
      exec(su, "DELETE FROM stored_object_deletions")
      // an update that leaves the file alone queues nothing
      asUser(db, U1)(app => exec(app, "UPDATE dataset_rows SET updated_at = now() WHERE id = 'r-1-a'") shouldBe 1)
      queueKeys(su) shouldBe empty
    }

    "queue nothing for keys outside the form-upload family, and never abort the delete on odd JSON" in withMigratedDb { (su, db) =>
      seed(su)
      val odd = Seq(
        """{"storageKey":"images/00000000-0000-4000-8000-000000000001.png"}""",       // image key
        """{"storageKey":"assistant-conversations/u/c.json"}""",                       // transcript key
        """{"storageKey":"form-uploads/not-a-uuid.pdf"}""",                            // right prefix, wrong shape
        """{"storageKey":"form-uploads/00000000-0000-4000-8000-000000000001.PDF"}""",  // upper-case ext
        """{"storageKey":"form-uploads/00000000-0000-4000-8000-000000000001.pdf/../x"}""",
        """{"storageKey":42}""", """{"storageKey":null}""", """{"storageKey":["form-uploads/x"]}""",
        """{"storageKey":{"storageKey":"form-uploads/zz"}}""", """"form-uploads/"""", """42""", """null""", """[]""",
        s"""[[[[[{"a":{"storageKey":"form-uploads/00000000-0000-4000-8000-000000000001.pdf\\n"}}]]]]]"""
      )
      odd.zipWithIndex.foreach { case (j, i) =>
        exec(su, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('odd-$i', 'ds-1', ${100 + i}, '${j.replace("'", "''")}'::jsonb, now(), now())")
      }
      asUser(db, U1)(app => exec(app, "DELETE FROM dataset_rows WHERE id LIKE 'odd-%'") shouldBe odd.size)
      rows(su, "SELECT count(*) FROM dataset_rows WHERE id LIKE 'odd-%'")(_.getInt(1)) shouldBe Vector(0)
      queueKeys(su) shouldBe empty
    }

    "extract a key nested at any depth under any property" in withMigratedDb { (su, db) =>
      seed(su)
      val nested = s"""{"a":[{"b":{"storageKey":"${formKey(5)}"}}], "storageKey":"${formKey(6)}"}"""
      exec(su, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('nest', 'ds-1', 50, '$nested'::jsonb, now(), now())")
      asUser(db, U1)(app => exec(app, "DELETE FROM dataset_rows WHERE id = 'nest'") shouldBe 1)
      queueKeys(su) shouldBe Set(formKey(5), formKey(6))
    }

    "commit an assistant-conversation delete as the owning RLS-bound user, queueing the transcript key" in withMigratedDb { (su, db) =>
      seed(su)
      Seq(("c1", U1), ("c2", U2), ("c3", U1)).foreach { case (id, u) =>
        exec(su, s"INSERT INTO assistant_conversations (id, owner_id, title, gcs_body_ref) VALUES ('$id', '$u', 't', 'assistant-conversations/$u/$id.json')")
      }
      exec(su, "INSERT INTO assistant_conversations (id, owner_id, title, gcs_body_ref) VALUES ('c-empty', '" + U1 + "', 't', '')")
      asUser(db, U1)(app => exec(app, "DELETE FROM assistant_conversations WHERE id = 'c1'") shouldBe 1)
      queueKeys(su) shouldBe Set(s"assistant-conversations/$U1/c1.json")
      // (the table's own policy reads the GUC without missing_ok, so a delete needs a user context; no cascade reaches it)
      asUser(db, U2)(app => exec(app, "DELETE FROM assistant_conversations WHERE id = 'c2'") shouldBe 1)
      asUser(db, U1)(app => exec(app, "DELETE FROM assistant_conversations WHERE id = 'c-empty'") shouldBe 1)
      queueKeys(su) shouldBe Set(s"assistant-conversations/$U1/c1.json", s"assistant-conversations/$U2/c2.json")
      rows(su, "SELECT count(*) FROM stored_object_deletions WHERE source_table = 'assistant_conversations' AND claimed_at = 'infinity' AND not_before IS NOT NULL")(_.getInt(1)) shouldBe Vector(2)
      rows(su, "SELECT count(*) FROM assistant_conversations")(_.getInt(1)) shouldBe Vector(1)
    }

    "queue every key of a TRUNCATE ... CASCADE, and nothing when it is rolled back" in withMigratedDb { (su, db) =>
      seed(su)
      exec(su, "INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('img-1', '" + U1 + "', 'images/a.png', 'image/png', 'a.png', 1)")
      exec(su, "INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id) VALUES ('csv-1', 'c', 'csv', '{\"path\":\"csv/a.csv\"}'::jsonb, now(), now(), '" + U1 + "')")
      exec(su, "INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id) VALUES ('rest-1', 'r', 'rest_api', '{\"path\":\"csv/not-a-file.csv\"}'::jsonb, now(), now(), '" + U1 + "')")
      exec(su, "INSERT INTO assistant_conversations (id, owner_id, title, gcs_body_ref) VALUES ('c1', '" + U2 + "', 't', 'assistant-conversations/c1.json')")
      val usersBefore = rows(su, "SELECT count(*) FROM users")(_.getInt(1))
      usersBefore.head should be > 1
      val app = roleConn(db)
      try {
        app.setAutoCommit(false)
        exec(app, "TRUNCATE users CASCADE")
        app.rollback()
      } finally app.close()
      queueKeys(su) shouldBe empty
      rows(su, "SELECT count(*) FROM users")(_.getInt(1)) shouldBe usersBefore

      val app2 = roleConn(db)
      try exec(app2, "TRUNCATE users CASCADE") finally app2.close()
      rows(su, "SELECT count(*) FROM users")(_.getInt(1)) shouldBe Vector(0)
      queueKeys(su) shouldBe Set(formKey(1), formKey(2), "images/a.png", "csv/a.csv", "assistant-conversations/c1.json")
      rows(su, "SELECT count(*) FROM stored_object_deletions WHERE claimed_at = 'infinity' AND not_before IS NOT NULL")(_.getInt(1)) shouldBe Vector(5)
    }

    "fire its triggers under session_replication_role = replica (ENABLE ALWAYS)" in withMigratedDb { (su, _) =>
      seed(su)
      exec(su, "SET session_replication_role = replica")
      exec(su, "DELETE FROM dataset_rows WHERE id = 'r-1-a'")
      queueKeys(su) shouldBe Set(formKey(1))
    }
  }
}
