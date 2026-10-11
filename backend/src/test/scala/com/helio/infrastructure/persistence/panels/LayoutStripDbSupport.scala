package com.helio.infrastructure.persistence.panels

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.sql.{Connection, DriverManager, ResultSet}
import java.util.UUID

/** Shared fixture for the HEL-1456 layout-strip migration specs: the production shape, where Flyway and the
 *  app are the same NOSUPERUSER / NOBYPASSRLS schema owner (`helio_migration_test`, standing in for `helio`) with
 *  FORCE ROW LEVEL SECURITY applying to it, and seeding goes through the superuser connection, which RLS
 *  cannot hide anything from. */
trait LayoutStripDbSupport {

  protected val Bps: Vector[String] = Vector("lg", "md", "sm", "xs")
  protected val AppRole             = "helio_migration_test"

  protected var pg: EmbeddedPostgres = _

  protected def startPostgres(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val su = superConn()
    try {
      exec(su, s"CREATE ROLE $AppRole LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      exec(su, s"ALTER SCHEMA public OWNER TO $AppRole")
      exec(su, s"GRANT CREATE, USAGE ON SCHEMA public TO $AppRole")
      exec(su, "CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      exec(su, s"GRANT helio_privileged TO $AppRole WITH ADMIN OPTION")
      val posture = rows(su, s"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '$AppRole'")(r => (r.getBoolean(1), r.getBoolean(2)))
      require(posture == Vector((false, false)), s"the app role must be NOSUPERUSER NOBYPASSRLS, got $posture")
    } finally su.close()
  }

  protected def flyway(target: Option[String]): Flyway = {
    val b = Flyway.configure().dataSource(pg.getJdbcUrl(AppRole, "postgres"), AppRole, "test").locations("classpath:db/migration")
    target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
    b.load()
  }

  protected def superConn(): Connection = pg.getPostgresDatabase.getConnection

  /** A fresh session as the app role, acting for `userId` (the RLS GUC the app pool sets per transaction). */
  protected def appConn(userId: String): Connection = {
    val c = DriverManager.getConnection(pg.getJdbcUrl(AppRole, "postgres"), AppRole, "test")
    exec(c, s"SELECT set_config('app.current_user_id', '$userId', false)")
    c
  }

  protected def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  protected def exec(c: Connection, sql: String): Int = {
    val st = c.createStatement()
    try { st.execute(sql); math.max(st.getUpdateCount, 0) } finally st.close()
  }

  protected def newId(): String = UUID.randomUUID().toString

  protected def item(id: String, y: Int, w: Int = 4): JsObject =
    JsObject("panelId" -> JsString(id), "x" -> JsNumber(0), "y" -> JsNumber(y), "w" -> JsNumber(w), "h" -> JsNumber(5))

  /** The same ordered items in every breakpoint, with a breakpoint-specific width so a stripped breakpoint cannot be confused with another. */
  protected def layout(ids: Seq[String]): JsObject =
    JsObject(Bps.zipWithIndex.map { case (bp, i) => bp -> JsArray(ids.zipWithIndex.map { case (id, row) => item(id, row * 5, 6 - i) }.toVector) }.toMap)

  protected def seedUser(su: Connection, id: String): Unit =
    exec(su, s"INSERT INTO users (id, email, created_at) VALUES ('$id'::uuid, 'u-$id@helio.test', now())")

  protected def seedDashboard(su: Connection, id: String, owner: String, layoutJson: JsValue): Unit =
    exec(su, s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
                |VALUES ('$id', 'd-$id', '$owner', now(), '2026-01-02T03:04:05Z', '{}'::jsonb, '${layoutJson.compactPrint}'::jsonb, '$owner'::uuid)""".stripMargin)

  protected def seedPanel(su: Connection, id: String, dashboardId: String, owner: String, outputId: Option[String] = None): Unit =
    exec(su, s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, output_id)
                |VALUES ('$id', '$dashboardId', 't-$id', '$owner', now(), now(), '{}'::jsonb, '${if (outputId.isDefined) "output" else "text"}',
                |        '$owner'::uuid, ${outputId.fold("NULL")(o => s"'$o'")})""".stripMargin)

  /** A pipeline (one static root) owning one Output; returns `(pipelineId, outputId)`. */
  protected def seedPipelineWithOutput(su: Connection, owner: String): (String, String) = {
    val (src, pl, out) = (newId(), newId(), newId())
    exec(su, s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                |VALUES ('$src'::uuid, 's', 'dataset', '{}'::jsonb, '$owner'::uuid, now(), now())""".stripMargin)
    exec(su, s"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ('$pl', 'p', '$owner'::uuid, now(), now())")
    exec(su, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('$pl', '$pl', '$src'::uuid, 0)")
    exec(su, s"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at, root_id)
                |VALUES ('$out', '$pl', NULL, '$owner'::uuid, 'o', 'table', '{}'::jsonb, '[]'::jsonb, 0, now(), now(), '$pl')""".stripMargin)
    (pl, out)
  }

  protected def storedLayout(c: Connection, dashboardId: String): JsValue =
    rows(c, s"SELECT layout::text FROM dashboards WHERE id = '$dashboardId'")(_.getString(1)).head.parseJson

  protected def panelIdsIn(layoutJson: JsValue, bp: String): Vector[String] =
    layoutJson.asJsObject.fields(bp).convertTo[Vector[JsObject]].map(_.fields("panelId").convertTo[String])

  /** `xmin` identifies the row version: unchanged means the row was not written at all. */
  protected def rowVersion(c: Connection, dashboardId: String): String =
    rows(c, s"SELECT xmin::text || '/' || last_updated::text FROM dashboards WHERE id = '$dashboardId'")(_.getString(1)).head
}
