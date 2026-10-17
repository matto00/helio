package com.helio.infrastructure.persistence

import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.{Connection, DriverManager}

/** HEL-1629 / MISTAKES.md "RLS policies never run in dev or CI": V137 (`hel1629_lock_pipelines`) applied the way production
 *  applies it, as a non-superuser, non-BYPASSRLS role that owns the schema (`helio_migration_test`, shaped like `helio`),
 *  then called as the non-BYPASSRLS application role and as the privileged role. The point of the function is that it locks
 *  rows the caller cannot see, so the spec proves it under REAL RLS: a plain `FOR NO KEY UPDATE` by the same role locks zero
 *  rows, the function locks them and reports the count. */
class V137LockPipelinesMigrationSpec extends AnyWordSpec with Matchers {

  private def withDb[A](body: (() => Connection, String) => A): A = {
    val pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    try {
      val superConn = pg.getPostgresDatabase.getConnection
      try {
        val st = superConn.createStatement()
        st.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
        st.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
        st.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
        st.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
        st.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
        st.close()
      } finally superConn.close()
      val url = pg.getJdbcUrl("helio_migration_test", "postgres")
      val result = Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration").load().migrate()
      result.success shouldBe true
      body(() => pg.getPostgresDatabase.getConnection, url)
    } finally pg.close()
  }

  private def connect(url: String): Connection = DriverManager.getConnection(url, "helio_migration_test", "test")

  private def ownerOnly(conn: Connection, sql: String): Unit = { val s = conn.createStatement(); try s.execute(sql) finally s.close() }

  private def scalar(conn: Connection, sql: String): String = {
    val s = conn.createStatement()
    try { val rs = s.executeQuery(sql); rs.next(); rs.getString(1) } finally s.close()
  }

  "V137 applied as a non-superuser role that owns the schema" should {
    "create hel1629_lock_pipelines as a SECURITY DEFINER function owned by helio_privileged, executable by the migrating role only" in withDb { (_, url) =>
      val conn = connect(url)
      try {
        scalar(conn, "SELECT prosecdef::text FROM pg_proc WHERE proname='hel1629_lock_pipelines'") shouldBe "true"
        scalar(conn, "SELECT proowner::regrole::text FROM pg_proc WHERE proname='hel1629_lock_pipelines'") shouldBe "helio_privileged"
        scalar(conn, "SELECT has_function_privilege('public','hel1629_lock_pipelines(text[],text[])','EXECUTE')::text") shouldBe "false"
        scalar(conn, "SELECT has_function_privilege('helio_migration_test','hel1629_lock_pipelines(text[],text[])','EXECUTE')::text") shouldBe "true"
      } finally conn.close()
    }

    "lock a pipeline the caller cannot see under RLS, report the count, and report a missing id as short" in withDb { (admin, url) =>
      val seedConn = admin()
      try {
        ownerOnly(seedConn, "INSERT INTO users (id,email,created_at,updated_at,tier) VALUES ('00000000-0000-0000-0000-0000000000a1','a@x',now(),now(),'owner'),('00000000-0000-0000-0000-0000000000a2','b@x',now(),now(),'owner')")
        ownerOnly(seedConn, "INSERT INTO pipelines (id,name,created_at,updated_at,owner_id) VALUES ('p-owned','n',now(),now(),'00000000-0000-0000-0000-0000000000a1')")
      } finally seedConn.close()
      val conn = connect(url)
      try {
        // The migrating role is NOT a superuser and NOT BYPASSRLS: as user A2 (not the owner) it sees no pipeline at all.
        ownerOnly(conn, "SELECT set_config('app.current_user_id','00000000-0000-0000-0000-0000000000a2',false)")
        scalar(conn, "SELECT count(*) FROM pipelines") shouldBe "0"
        conn.setAutoCommit(false)
        scalar(conn, "SELECT count(*) FROM (SELECT 1 FROM pipelines WHERE id='p-owned' FOR NO KEY UPDATE) x") shouldBe "0"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY['p-owned'], ARRAY[]::text[])") shouldBe "1"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY['p-owned','p-gone'], ARRAY[]::text[])") shouldBe "1"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY[]::text[], ARRAY[]::text[])") shouldBe "0"
        conn.commit()
      } finally conn.close()
    }
    "lock every pipeline rooted on a given source, whoever owns it and whatever the caller can see, via p_source_ids" in withDb { (admin, url) =>
      val seedConn = admin()
      try {
        ownerOnly(seedConn, "INSERT INTO users (id,email,created_at,updated_at,tier) VALUES ('00000000-0000-0000-0000-0000000000b1','c@x',now(),now(),'owner'),('00000000-0000-0000-0000-0000000000b2','d@x',now(),now(),'owner')")
        ownerOnly(seedConn, "INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('ds-shared','s','dataset','{}',now(),now(),'00000000-0000-0000-0000-0000000000b1','[]')")
        ownerOnly(seedConn, "INSERT INTO pipelines (id,name,created_at,updated_at,owner_id) VALUES ('p-b1','n',now(),now(),'00000000-0000-0000-0000-0000000000b1'),('p-b2','n',now(),now(),'00000000-0000-0000-0000-0000000000b2'),('p-unrelated','n',now(),now(),'00000000-0000-0000-0000-0000000000b2')")
        ownerOnly(seedConn, "INSERT INTO pipeline_roots (id,pipeline_id,data_source_id,position,created_at) VALUES ('rb1','p-b1','ds-shared',0,now()),('rb2','p-b2','ds-shared',0,now())")
      } finally seedConn.close()
      val conn = connect(url)
      try {
        // The source's owner (b1) cannot see b2's pipeline under RLS, yet deleting the source cascades into it.
        ownerOnly(conn, "SELECT set_config('app.current_user_id','00000000-0000-0000-0000-0000000000b1',false)")
        scalar(conn, "SELECT count(*) FROM pipelines WHERE id='p-b2'") shouldBe "0"
        conn.setAutoCommit(false)
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY[]::text[], ARRAY['ds-shared'])") shouldBe "2"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY['p-unrelated'], ARRAY['ds-shared'])") shouldBe "3"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY['p-b1'], ARRAY['ds-shared'])") shouldBe "2"
        scalar(conn, "SELECT hel1629_lock_pipelines(ARRAY[]::text[], ARRAY['ds-none'])") shouldBe "0"
        conn.commit()
      } finally conn.close()
    }
  }
}
