package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.postgresql.util.PSQLException
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1104 task 2.1: proves V107's re-added `pipeline_steps_op_check` (1) still validates every
 *  one of the 23 pre-existing ops against REAL pre-existing rows (a re-added CHECK constraint
 *  validates existing data, so a hand-copied op tuple that dropped or mistyped one would fail
 *  loudly here), (2) newly accepts all four write-back ops, and (3) still rejects a bogus op
 *  string. Runs as the `postgres` superuser -- this is a data-correctness proof of the constraint
 *  itself, not an RLS/ownership proof (that split is `V99PreventZeroRootPipelinesMigrationSpec`'s
 *  own precedent); the non-superuser ownership question is `FlywayNonSuperuserMigrationSpec`'s and
 *  `PipelineStepsOpCheckOwnershipRequiredSpec`'s job. */
class PipelineStepsOpCheckSeededRowsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  // Verbatim from V83__add_assert_op.sql -- the full pre-V107 allow-list.
  private val existingOps = Seq(
    "rename", "filter", "join", "compute", "groupby", "cast", "select", "limit", "sort",
    "aggregate", "splittext", "extractheadings", "chunkbytokencount", "datebucket", "pivot",
    "window", "unpivot", "dedupe", "fillnull", "stringops", "union", "lookup", "assert"
  )

  private val newOps = Seq("upsertsource", "convertformat", "analyzewithai", "generatetext")

  "V107's re-added pipeline_steps_op_check, applied against a table already holding rows for every existing op" should {

    "keep every seeded existing-op row valid, accept all four new ops, and still reject a bogus op" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

        // Migrate to V106 (pre-V107) so the seeded rows are validated by the OLD constraint first.
        Flyway
          .configure()
          .dataSource(jdbcUrl, "postgres", "postgres")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("106"))
          .load()
          .migrate()

        val db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
        val ownerId = UUID.randomUUID().toString
        val pipelineId = UUID.randomUUID().toString
        val dataSourceId = UUID.randomUUID().toString
        val rootId = UUID.randomUUID().toString

        try {
          await(
            db.run(
              DBIO.seq(
                sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'hel1104@test.local', now())""",
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                       VALUES ($dataSourceId, 'hel1104-source', 'dataset', '{}', $ownerId::uuid, now(), now())""",
                sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at)
                       VALUES ($pipelineId, 'hel1104-op-check', $ownerId::uuid, now(), now())""",
                sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
                       VALUES ($rootId, $pipelineId, $dataSourceId, 0)"""
              )
            )
          )

          // Seed one pipeline_steps row for EVERY existing op, validated under the pre-V107
          // constraint -- proves this is realistic pre-existing data, not a fixture invented
          // post-hoc to happen to pass. Every seeded row is parentless (root_id set, per V98's
          // `pipeline_steps_root_id_matches_parentless` CHECK), which is orthogonal to the op
          // constraint under test.
          existingOps.zipWithIndex.foreach { case (op, idx) =>
            await(
              db.run(
                sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id, created_at, updated_at)
                       VALUES (${s"hel1104-seed-$op"}, $pipelineId, $idx, $op, '{}', $rootId, now(), now())"""
              )
            )
          }

          // ── Apply V107 ──
          noException should be thrownBy {
            Flyway
              .configure()
              .dataSource(jdbcUrl, "postgres", "postgres")
              .locations("classpath:db/migration")
              .load()
              .migrate()
          }

          // Every seeded existing-op row must still be present and pass the re-added CHECK --
          // a dropped/mistyped op in the hand-copied tuple would have failed the migration itself
          // (re-adding a CHECK constraint validates existing rows), so surviving to here is
          // already evidence, but assert row-for-row anyway for a precise failure signal.
          existingOps.foreach { op =>
            val count = await(db.run(sql"SELECT count(*) FROM pipeline_steps WHERE id = ${s"hel1104-seed-$op"} AND op = $op".as[Int].head))
            withClue(s"seeded row for pre-existing op '$op' should still exist and satisfy the re-added CHECK: ") {
              count shouldBe 1
            }
          }

          // All four new ops are now insertable.
          newOps.zipWithIndex.foreach { case (op, idx) =>
            noException should be thrownBy await(
              db.run(
                sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id, created_at, updated_at)
                       VALUES (${s"hel1104-new-$op"}, $pipelineId, ${existingOps.size + idx}, $op, '{}', $rootId, now(), now())"""
              )
            )
          }

          // A bogus/unknown op string is still rejected.
          val ex = intercept[PSQLException] {
            await(
              db.run(
                sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id, created_at, updated_at)
                       VALUES ('hel1104-bogus', $pipelineId, 999, 'not_a_real_op', '{}', $rootId, now(), now())"""
              )
            )
          }
          ex.getMessage should include("pipeline_steps_op_check")
        } finally db.close()
      } finally embeddedPostgres.close()
    }
  }
}
