package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.{NodeStepInput, analyzeNodes, schemaFieldJsonFormat}
import com.helio.domain.model.DataFieldType
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.io.Source

/** HEL-906 cycle 6 (evaluation-5.md CR1, coordinator ruling carried from cycle 5): the
 *  explicit, non-negotiable fixture-based invariant guard -- "a test asserting that every
 *  field type in the projected schema for a representative fixture pipeline (use the real
 *  scrubbed dump) satisfies `DataFieldType.fromString`". `SchemaFieldStructuralGuardSpec`
 *  already proves the invariant holds IN MEMORY, by construction, for every one of the 31+
 *  `SchemaField(...)` call sites -- but it never exercises real, already-persisted production
 *  data. This spec is the complement: it loads the actual scrubbed `pg_dump` fixture
 *  (`db/fixtures/hel904-real-dump.sql`, the same one `V94OutputsMigrationSpec` uses) into a
 *  fully-migrated Postgres, picks a real multi-step pipeline (the same `manyStepsPipelineId`
 *  that spec already documents as real), reads its REAL persisted `data_sources.inferred_schema`
 *  and REAL persisted `pipeline_steps` rows, runs them through the actual `analyzeNodes`
 *  production code path (trunk + at least one tail), and asserts every field of every resulting
 *  node's projected output schema satisfies `DataFieldType.fromString`.
 *
 *  Since `SchemaField`'s own constructor `require`s this already, a violation here would
 *  surface as an exception during `analyzeNodes` itself (a step's `inferOutputSchema` failing
 *  to canonicalize before constructing a `SchemaField`) rather than a false assertion --
 *  this spec still asserts the invariant explicitly against every field it observes, so the
 *  intent is legible even though the guard is structurally unbypassable today. */
class SchemaFieldRealDumpInvariantSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  // Same real, hand-verified pipeline `V94OutputsMigrationSpec` uses for its step-order
  // assertions: a real many-step (>=3) pipeline from the actual scrubbed dev-DB dump.
  private val manyStepsPipelineId = "6ba5075b-2291-4508-881b-a517b1f300cf"

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // Migrate only to pre-V94 first so the dump (captured against the pre-V94 schema) loads
    // cleanly, exactly like V94OutputsMigrationSpec -- then migrate the rest of the way so the
    // real `analyzeNodes` production code path runs against the CURRENT (post-V94) schema
    // shape (parent_step_id tree, inferred_schema on data_sources).
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .target(org.flywaydb.core.api.MigrationVersion.fromVersion("93"))
      .load()
      .migrate()

    val setupDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
    try {
      await(setupDb.run(sqlu"""
        TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
          dashboards, metrics, binary_refs, data_type_rows, patch_set_applications
          RESTART IDENTITY CASCADE
      """))
      val dumpSql = {
        val src = Source.fromResource("db/fixtures/hel904-real-dump.sql")
        try src.mkString finally src.close()
      }
      val rawConn = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        val stmt = rawConn.createStatement()
        try stmt.execute(dumpSql) finally stmt.close()
      } finally rawConn.close()
    } finally setupDb.close()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private def assertCanonical(fields: Vector[SchemaField], where: String): Unit =
    fields.foreach { f =>
      withClue(s"$where field '${f.name}' has type '${f.`type`}': ") {
        DataFieldType.fromString(f.`type`) shouldBe defined
      }
    }

  "the real dump's projected schema, walked through the actual analyzeNodes production path" should {
    "satisfy DataFieldType.fromString for every field of the source schema, the trunk, and every tail" in {
      // The real, persisted source schema for this pipeline's source data source -- read
      // through the SAME tolerant `schemaFieldJsonFormat` the production code path uses
      // (`PipelineService`/`PipelineRunService`), so a genuinely poisoned persisted row would
      // be caught here exactly the way it would in production.
      val (sourceDataSourceId, rawSchema) = await(db.run(
        sql"""SELECT ds.id, ds.inferred_schema::text
              FROM pipelines p JOIN data_sources ds ON ds.id = p.source_data_source_id
              WHERE p.id = $manyStepsPipelineId"""
          .as[(String, String)].head
      ))
      sourceDataSourceId should not be empty

      val sourceSchema: Vector[SchemaField] = rawSchema.parseJson.convertTo[Vector[SchemaField]]
      sourceSchema should not be empty
      assertCanonical(sourceSchema, "source schema")

      // Real, persisted steps for this pipeline -- op/config/parent_step_id exactly as
      // production stores them, fed through the real `analyzeNodes` function (not a
      // reimplementation), covering trunk + every tail.
      val rows = await(db.run(
        sql"""SELECT id, parent_step_id, position, op, config FROM pipeline_steps
              WHERE pipeline_id = $manyStepsPipelineId"""
          .as[(String, Option[String], Int, String, String)]
      ))
      rows.size should be >= 3

      val inputs = rows.map { case (id, parent, pos, op, cfg) =>
        NodeStepInput(id = id, parentStepId = parent, position = pos, op = op, config = cfg)
      }

      val projected = analyzeNodes(inputs, sourceSchema)
      projected.keySet.size shouldBe rows.size

      // Trunk: the deepest chain from the (single) root.
      val rootId = rows.collectFirst { case (id, None, _, _, _) => id }.get
      projected.get(rootId) shouldBe defined
      assertCanonical(projected(rootId).outputSchema, s"trunk root node $rootId")

      // Every node (trunk + every tail branch) -- exercising `analyzeNodes`' full tree walk,
      // not just the trunk.
      projected.foreach { case (id, analyzedStep) =>
        assertCanonical(analyzedStep.outputSchema, s"node $id")
      }
    }
  }
}
