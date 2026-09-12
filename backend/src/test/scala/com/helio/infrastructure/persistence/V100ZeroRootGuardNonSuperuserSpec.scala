package com.helio.infrastructure.persistence

import com.helio.testkit.TempDirectorySupport

import com.helio.domain.model.{AuditSource, AuthenticatedUser, CsvSource, CsvSourceConfig, DataSourceId, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import com.typesafe.config.ConfigFactory
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.postgresql.util.PSQLException
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.nio.file.Files
import java.sql.{Connection, DriverManager}
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-974 design.md D4/D5/D9/D10 -- the permanent non-superuser gate proving the zero-root
 *  guard (V99 + V100) is RLS-independent, plus the D9 divergence gates for the companion
 *  privileged pre-check in `DataSourceService.delete`.
 *
 *  Deliberately NOT an extension of `FlywayNonSuperuserMigrationSpec` (design D4): that spec's
 *  own header warns against reordering/"simplifying away" its load-bearing comparison, and this
 *  spec's delete-and-expect-raise sequences would have to run inside its transaction-less body.
 *  This spec skips `FlywayNonSuperuserMigrationSpec`'s expensive 10k-line dump load -- it needs
 *  only the schema, not realistic data.
 *
 *  Role shape copied verbatim from `FlywayNonSuperuserMigrationSpec`: `helio_migration_test`
 *  (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owner of `public`), with
 *  `helio_privileged` pre-seeded and granted `WITH ADMIN OPTION` -- the shape that makes FORCE
 *  ROW LEVEL SECURITY apply to the migrating connection at all, exactly like production's
 *  `DB_USER`.
 *
 *  Design D10: the D9 gates below run over TWO GENUINELY DISTINCT pools -- an app connection as
 *  `helio_migration_test` and a SEPARATE `helio_privileged` connection (`connectionInitSql = "SET
 *  ROLE helio_privileged"`, mirroring `Database.initPrivileged`'s own mechanism) -- NOT
 *  `DataSourceRoutesSpec`'s `new DbContext(db, db)` shape, which shares one BYPASSRLS superuser
 *  connection across both "pools" and would make every gate below pass vacuously.
 */
class V100ZeroRootGuardNonSuperuserSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def ec: ExecutionContext                       = typedSystem.executionContext

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var migrationUrl: String               = _

  // Two genuinely distinct Slick pools for the D9 harness (design D10).
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var fileSystem: LocalFileSystem        = _
  private var service: DataSourceService         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      stmt.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
      stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      stmt.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      stmt.close()
    } finally superConn.close()

    migrationUrl = embeddedPostgres.getJdbcUrl("helio_migration_test", "postgres")

    Flyway
      .configure()
      .dataSource(migrationUrl, "helio_migration_test", "test")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    // App pool: plain connections as helio_migration_test, no role escalation --
    // matches `Database.initApp`.
    appDb = JdbcBackend.Database.forURL(
      s"$migrationUrl${if (migrationUrl.contains('?')) "&" else "?"}stringtype=unspecified",
      user = "helio_migration_test",
      password = "test",
      driver = "org.postgresql.Driver"
    )

    // Privileged pool: connectionInitSql escalates every pooled connection to helio_privileged
    // (BYPASSRLS) -- byte-for-byte the mechanism `Database.initPrivileged` documents.
    val privilegedConfig = ConfigFactory.parseString(
      s"""privileged {
         |  url = "$migrationUrl${if (migrationUrl.contains('?')) "&" else "?"}stringtype=unspecified"
         |  user = "helio_migration_test"
         |  password = "test"
         |  driver = "org.postgresql.Driver"
         |  connectionInitSql = "SET ROLE helio_privileged"
         |  numThreads = 2
         |  connectionPool = "HikariCP"
         |}""".stripMargin
    )
    privilegedDb = JdbcBackend.Database.forConfig("privileged", privilegedConfig)

    ctx = new DbContext(appDb, privilegedDb)(ec)
    dataSourceRepo = new DataSourceRepository(ctx)(ec)

    val tmpDir = newTempDir("hel974-v100-spec")
    fileSystem = new LocalFileSystem(tmpDir)(ec)
    service = new DataSourceService(dataSourceRepo, fileSystem)
  }

  override def afterAll(): Unit = {
    if (appDb != null) appDb.close()
    if (privilegedDb != null) privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  // ── Low-level SQL-side fixture helpers (tasks 3.1-3.7a) ────────────────────

  private def freshConn(): Connection = {
    val c = DriverManager.getConnection(migrationUrl, "helio_migration_test", "test")
    c.setAutoCommit(true)
    c
  }

  private def asPrivileged(conn: Connection): Unit = {
    val s = conn.createStatement()
    try s.execute("SET ROLE helio_privileged")
    finally s.close()
  }

  private def exec(conn: Connection, sql: String): Unit = {
    val s = conn.createStatement()
    try s.execute(sql)
    finally s.close()
  }

  private def scalarInt(conn: Connection, sql: String): Int = {
    val s = conn.createStatement()
    try {
      val rs = s.executeQuery(sql)
      rs.next(); rs.getInt(1)
    } finally s.close()
  }

  /** Seed one user + one sole-root pipeline (owned by `ownerId`), via a privileged connection so
   *  the insert itself is never gated by RLS regardless of GUC state. Returns (pipelineId, dsId). */
  private def seedSoleRootFixture(ownerId: String): (String, String) = {
    val pid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    val conn = freshConn()
    try {
      asPrivileged(conn)
      exec(conn, s"INSERT INTO users (id, email, created_at) VALUES ('$ownerId'::uuid, 'v100-$ownerId@test.local', now()) ON CONFLICT (id) DO NOTHING")
      exec(
        conn,
        s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
           |VALUES ('$dsId', 'v100-ds', 'dataset', '{"columns":[],"rows":[]}', '$ownerId'::uuid, now(), now())""".stripMargin
      )
      exec(conn, s"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ('$pid', 'v100-pipeline', '$ownerId'::uuid, now(), now())")
      exec(conn, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('${UUID.randomUUID()}', '$pid', '$dsId', 0)")
    } finally conn.close()
    (pid, dsId)
  }

  /** Delete `data_sources` row `dsId`, on a connection either escalated to `helio_privileged`
   *  (GUC never touched -- the D1/D2 defect shape) or on the plain app role with `app.current_user_id`
   *  set to `guc` (D5 step 3's parity check). Returns (raisedMessage, sqlState). */
  private def attemptDelete(dsId: String, privileged: Boolean, guc: Option[String]): (Option[String], Option[String]) = {
    val conn = freshConn()
    try {
      if (privileged) asPrivileged(conn)
      guc.foreach(uid => exec(conn, s"SELECT set_config('app.current_user_id', '$uid', false)"))
      try {
        exec(conn, s"DELETE FROM data_sources WHERE id = '$dsId'")
        (None, None)
      } catch {
        case e: PSQLException => (Option(e.getMessage), Option(e.getSQLState))
      }
    } finally conn.close()
  }

  private val originalFunctionBody =
    """CREATE OR REPLACE FUNCTION hel913_prevent_zero_root_pipelines() RETURNS TRIGGER
      |  LANGUAGE plpgsql
      |  SECURITY DEFINER
      |  SET search_path = pg_catalog, public
      |AS $BODY$
      |DECLARE
      |  orphaned_pipeline_ids TEXT;
      |BEGIN
      |  SELECT string_agg(p.id, ', ') INTO orphaned_pipeline_ids
      |  FROM (SELECT DISTINCT pipeline_id FROM deleted_roots) AS d
      |  JOIN pipelines p ON p.id = d.pipeline_id
      |  WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots pr WHERE pr.pipeline_id = p.id);
      |
      |  IF orphaned_pipeline_ids IS NOT NULL THEN
      |    RAISE EXCEPTION
      |      'HEL-913: this delete would leave pipeline(s) [%] with zero roots (R1 violation) -- remove the pipeline itself instead of its last root, or add another root first',
      |      orphaned_pipeline_ids;
      |  END IF;
      |  RETURN NULL;
      |END;
      |$BODY$;""".stripMargin

  private val fixedFunctionBody =
    """CREATE OR REPLACE FUNCTION hel913_prevent_zero_root_pipelines() RETURNS TRIGGER
      |  LANGUAGE plpgsql
      |  SECURITY DEFINER
      |  SET search_path = pg_catalog, public
      |  SET row_security = off
      |AS $BODY$
      |DECLARE
      |  orphaned_pipeline_ids TEXT;
      |BEGIN
      |  SELECT string_agg(p.id, ', ') INTO orphaned_pipeline_ids
      |  FROM (SELECT DISTINCT pipeline_id FROM deleted_roots) AS d
      |  JOIN pipelines p ON p.id = d.pipeline_id
      |  WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots pr WHERE pr.pipeline_id = p.id);
      |
      |  IF orphaned_pipeline_ids IS NOT NULL THEN
      |    RAISE EXCEPTION
      |      'HEL-913: this delete would leave pipeline(s) [%] with zero roots (R1 violation) -- remove the pipeline itself instead of its last root, or add another root first',
      |      orphaned_pipeline_ids;
      |  END IF;
      |  RETURN NULL;
      |END;
      |$BODY$;""".stripMargin

  /** Mutation control: uses the EmbeddedPostgres `postgres` SUPERUSER connection, which can
   *  `CREATE OR REPLACE`/`ALTER ... OWNER TO` regardless of current ownership -- sidesteps the
   *  transient `GRANT CREATE` bracket V100 itself needs, entirely in-memory, never touching
   *  `V100__zero_root_guard_rls_independent.sql` on disk (design D8: mutation work is
   *  EmbeddedPostgres-only, and per the ticket's non-negotiables, an applied migration file is
   *  NEVER edited). */
  private def mutateFunction(body: String, owner: String): Unit = {
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val s = superConn.createStatement()
      try {
        s.execute(body)
        s.execute(s"ALTER FUNCTION hel913_prevent_zero_root_pipelines() OWNER TO $owner")
      } finally s.close()
    } finally superConn.close()
  }

  private def restoreV100State(): Unit = mutateFunction(fixedFunctionBody, "helio_privileged")

  // ── Tests ────────────────────────────────────────────────────────────────

  "the V100-fixed hel913_prevent_zero_root_pipelines guard, exercised as a genuine non-superuser role" should {

    "3.2 positive gate: with app.current_user_id UNSET (privileged-pool delete), the guard raises P0001 and rolls back" in {
      val owner       = UUID.randomUUID().toString
      val (pid, dsId) = seedSoleRootFixture(owner)

      val (msg, state) = attemptDelete(dsId, privileged = true, guc = None)

      msg shouldBe defined
      msg.get should include("HEL-913")
      msg.get should include("zero roots")
      state shouldBe Some("P0001")

      // Rollback proof -- a raise alone does not establish this.
      val conn = freshConn()
      try {
        asPrivileged(conn)
        scalarInt(conn, s"SELECT count(*) FROM pipelines WHERE id = '$pid'") shouldBe 1
        scalarInt(conn, s"SELECT count(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldBe 1
        scalarInt(conn, s"SELECT count(*) FROM data_sources WHERE id = '$dsId'") shouldBe 1
      } finally conn.close()
    }

    "3.3 parity gate: the identical delete WITH the GUC set to the owner raises identically (HEL-987's mapping is unaffected)" in {
      val owner       = UUID.randomUUID().toString
      val (_, dsId)   = seedSoleRootFixture(owner)

      val (msg, state) = attemptDelete(dsId, privileged = false, guc = Some(owner))

      msg shouldBe defined
      msg.get should include("HEL-913")
      state shouldBe Some("P0001")
    }

    "3.4 negative gate, GUC UNSET: deleting one of two roots succeeds, the other root survives" in {
      val owner = UUID.randomUUID().toString
      val pid   = UUID.randomUUID().toString
      val ds1   = UUID.randomUUID().toString
      val ds2   = UUID.randomUUID().toString
      val conn  = freshConn()
      try {
        asPrivileged(conn)
        exec(conn, s"INSERT INTO users (id, email, created_at) VALUES ('$owner'::uuid, 'v100-$owner@test.local', now()) ON CONFLICT (id) DO NOTHING")
        for ((ds, idx) <- Seq(ds1, ds2).zipWithIndex)
          exec(
            conn,
            s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               |VALUES ('$ds', 'v100-ds-$idx', 'dataset', '{"columns":[],"rows":[]}', '$owner'::uuid, now(), now())""".stripMargin
          )
        exec(conn, s"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ('$pid', 'v100-pipeline', '$owner'::uuid, now(), now())")
        exec(conn, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('${UUID.randomUUID()}', '$pid', '$ds1', 0)")
        exec(conn, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('${UUID.randomUUID()}', '$pid', '$ds2', 1)")
      } finally conn.close()

      val (msg, _) = attemptDelete(ds1, privileged = true, guc = None)
      msg shouldBe None

      val checkConn = freshConn()
      try {
        asPrivileged(checkConn)
        scalarInt(checkConn, s"SELECT count(*) FROM pipelines WHERE id = '$pid'") shouldBe 1
        scalarInt(checkConn, s"SELECT count(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldBe 1
      } finally checkConn.close()
    }

    "3.5 negative gate, GUC UNSET: deleting the whole pipeline succeeds and raises nothing" in {
      val owner       = UUID.randomUUID().toString
      val (pid, _)    = seedSoleRootFixture(owner)

      val conn = freshConn()
      try {
        asPrivileged(conn)
        noException should be thrownBy exec(conn, s"DELETE FROM pipelines WHERE id = '$pid'")
        scalarInt(conn, s"SELECT count(*) FROM pipelines WHERE id = '$pid'") shouldBe 0
        scalarInt(conn, s"SELECT count(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldBe 0
      } finally conn.close()
    }

    "3.6 guard-liveness: the trigger function is owned by helio_privileged" in {
      val conn = freshConn()
      try {
        val s = conn.createStatement()
        try {
          val rs = s.executeQuery(
            "SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'hel913_prevent_zero_root_pipelines'"
          )
          rs.next()
          rs.getString(1) shouldBe "helio_privileged"
        } finally s.close()
      } finally conn.close()
    }

    "3.7 MUTATION STATE A (revert OWNER TO + remove SET row_security=off): the guard goes SILENTLY red" in {
      val owner       = UUID.randomUUID().toString
      val (pid, dsId) = seedSoleRootFixture(owner)

      mutateFunction(originalFunctionBody, "helio_migration_test")
      try {
        val (msg, state) = attemptDelete(dsId, privileged = true, guc = None)

        // Right-reason red: SILENT non-firing, not an error of any kind.
        msg shouldBe None
        state shouldBe None

        val conn = freshConn()
        try {
          asPrivileged(conn)
          withClue("STATE A right-reason red -- silent orphan, pipelines=1: ") {
            scalarInt(conn, s"SELECT count(*) FROM pipelines WHERE id = '$pid'") shouldBe 1
          }
          withClue("STATE A right-reason red -- silent orphan, pipeline_roots=0: ") {
            scalarInt(conn, s"SELECT count(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldBe 0
          }
        } finally conn.close()
      } finally restoreV100State()
    }

    "3.7a MUTATION STATE B (revert OWNER TO, KEEP SET row_security=off): the tripwire goes LOUDLY red with 42501" in {
      val owner       = UUID.randomUUID().toString
      val (_, dsId)   = seedSoleRootFixture(owner)

      mutateFunction(fixedFunctionBody, "helio_migration_test")
      try {
        val (msg, state) = attemptDelete(dsId, privileged = true, guc = None)

        // Right-reason red: LOUD, 42501, NOT the "permission denied on pipelines/pipeline_roots"
        // wrong-reason of 3.7 and NOT a silent non-raise (that would mean the tripwire is dead).
        msg shouldBe defined
        msg.get should include("row-level security policy")
        state shouldBe Some("42501")
      } finally restoreV100State()
    }

    "post-mutation sanity: the guard is back in its correct V100 state (owner + tripwire) after both mutation tests" in {
      val owner       = UUID.randomUUID().toString
      val (_, dsId)   = seedSoleRootFixture(owner)

      val (msg, state) = attemptDelete(dsId, privileged = true, guc = None)
      msg shouldBe defined
      msg.get should include("HEL-913")
      state shouldBe Some("P0001")

      val conn = freshConn()
      try {
        val s = conn.createStatement()
        try {
          val rs = s.executeQuery(
            "SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'hel913_prevent_zero_root_pipelines'"
          )
          rs.next()
          rs.getString(1) shouldBe "helio_privileged"
        } finally s.close()
      } finally conn.close()
    }
  }

  // ── D9 harness (tasks 3.7b1, 3.7c-3.7f) -- service-level, two genuinely distinct pools ──────

  private def authUser(id: String): AuthenticatedUser = AuthenticatedUser(UserId(id), AuditSource.Ui, None)

  private def seedUserRaw(id: String): Unit = {
    val conn = freshConn()
    try {
      asPrivileged(conn)
      exec(conn, s"INSERT INTO users (id, email, created_at) VALUES ('$id'::uuid, 'v100-d9-$id@test.local', now()) ON CONFLICT (id) DO NOTHING")
    } finally conn.close()
  }

  /** Inserts a real CSV source owned by `sourceOwnerId`, with a real backing file, then binds it
   *  as a root of a pipeline owned by `pipelineOwnerId` (raw SQL, privileged connection -- ACL is
   *  not the thing under test here). When `pipelineOwnerId != sourceOwnerId` the resulting
   *  pipeline is INVISIBLE to `sourceOwnerId`'s own RLS-scoped `soleRootDependentPipelines`,
   *  which is exactly the D9 fixture shape. Returns (dataSourceId, pipelineId, filePath). */
  private def seedRootedSource(sourceOwnerId: String, pipelineOwnerId: String, extraRootDsIds: Vector[String] = Vector.empty): (DataSourceId, String, String) = {
    seedUserRaw(sourceOwnerId)
    seedUserRaw(pipelineOwnerId)

    val filePath = s"v100-d9-${UUID.randomUUID()}.csv"
    await(fileSystem.write(filePath, "a,b\n1,2\n".getBytes))

    val source = CsvSource(
      id = DataSourceId(UUID.randomUUID().toString),
      name = "v100-d9-source",
      ownerId = UserId(sourceOwnerId),
      createdAt = Instant.now(),
      updatedAt = Instant.now(),
      config = CsvSourceConfig(path = filePath)
    )
    await(dataSourceRepo.insert(source, authUser(sourceOwnerId)))

    val pid = UUID.randomUUID().toString
    val conn = freshConn()
    try {
      asPrivileged(conn)
      exec(conn, s"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ('$pid', 'v100-d9-pipeline', '$pipelineOwnerId'::uuid, now(), now())")
      exec(conn, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('${UUID.randomUUID()}', '$pid', '${source.id.value}', 0)")
      for ((extraDs, idx) <- extraRootDsIds.zipWithIndex)
        exec(conn, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('${UUID.randomUUID()}', '$pid', '$extraDs', ${idx + 1})")
    } finally conn.close()

    (source.id, pid, filePath)
  }

  private def seedBareSource(ownerId: String): DataSourceId = {
    seedUserRaw(ownerId)
    val filePath = s"v100-d9-extra-${UUID.randomUUID()}.csv"
    await(fileSystem.write(filePath, "x\n1\n".getBytes))
    val source = CsvSource(
      id = DataSourceId(UUID.randomUUID().toString),
      name = "v100-d9-extra-source",
      ownerId = UserId(ownerId),
      createdAt = Instant.now(),
      updatedAt = Instant.now(),
      config = CsvSourceConfig(path = filePath)
    )
    await(dataSourceRepo.insert(source, authUser(ownerId)))
    source.id
  }

  "the D9 privileged, count-only pre-check in DataSourceService.delete" should {

    "3.7c divergence gate: a sole-root pipeline invisible to the caller's own RLS-scoped check is still refused, and the file survives" in {
      val callerId   = UUID.randomUUID().toString
      val strangerId = UUID.randomUUID().toString
      val (dsId, _, filePath) = seedRootedSource(sourceOwnerId = callerId, pipelineOwnerId = strangerId)

      // Fixture liveness (mandatory, design D10): without this, a fixture that drifts back into
      // visibility would silently downgrade this gate into a re-test of the visible path.
      val rlsScoped = await(dataSourceRepo.soleRootDependentPipelines(dsId, authUser(callerId)))
      withClue("fixture liveness -- the RLS-scoped pre-check must see NOTHING for this fixture: ") {
        rlsScoped shouldBe empty
      }

      val result = await(service.delete(dsId, authUser(callerId)))
      result.isLeft shouldBe true
      result.left.toOption.get.conflict shouldBe defined

      await(fileSystem.exists(filePath)) shouldBe true
    }

    "3.7d non-disclosure gate: the invisible-pipeline 409 names no pipeline id or name" in {
      val callerId   = UUID.randomUUID().toString
      val strangerId = UUID.randomUUID().toString
      val (dsId, pid, _) = seedRootedSource(sourceOwnerId = callerId, pipelineOwnerId = strangerId)

      val rlsScoped = await(dataSourceRepo.soleRootDependentPipelines(dsId, authUser(callerId)))
      rlsScoped shouldBe empty // fixture liveness, mandatory

      val result = await(service.delete(dsId, authUser(callerId)))
      val conflict = result.left.toOption.get.conflict.get

      conflict.reason should not include pid
      conflict.resourceId should not be pid
      conflict.resourceName should not include "v100-d9-pipeline"
      result.left.toOption.get.err.message should not include pid

      // No log line is emitted on this specific branch (unlike the race-path recover, which
      // does `log.warn`) -- stated plainly rather than asserted against silence, per task 3.7d.
    }

    "3.7e regression gate: a VISIBLE blocking pipeline still produces HEL-987's existing named 409, unchanged" in {
      val ownerId = UUID.randomUUID().toString
      val (dsId, pid, _) = seedRootedSource(sourceOwnerId = ownerId, pipelineOwnerId = ownerId)

      val result = await(service.delete(dsId, authUser(ownerId)))
      val conflict = result.left.toOption.get.conflict.get

      conflict.reason should include(pid)
      conflict.reason should include("v100-d9-pipeline")
      conflict.resourceKind shouldBe "data_source"
      conflict.resourceId shouldBe dsId.value
    }

    "3.7f service-level false-positive gate: a source that is one of SEVERAL roots of an INVISIBLE pipeline still deletes, file removed" in {
      val callerId   = UUID.randomUUID().toString
      val strangerId = UUID.randomUUID().toString
      val secondRootDs = seedBareSource(strangerId)
      val (dsId, _, filePath) = seedRootedSource(sourceOwnerId = callerId, pipelineOwnerId = strangerId, extraRootDsIds = Vector(secondRootDs.value))

      val rlsScoped = await(dataSourceRepo.soleRootDependentPipelines(dsId, authUser(callerId)))
      rlsScoped shouldBe empty // fixture liveness

      val result = await(service.delete(dsId, authUser(callerId)))
      result shouldBe Right(())

      await(fileSystem.exists(filePath)) shouldBe false
    }
  }
}
