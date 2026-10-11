package com.helio.infrastructure.persistence.auth

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.{Role, UserId}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1488 site 6: `ResourcePermissionRepository.rowToDomain` reads an unknown stored role string as
 *  `Role.Viewer`, the least-privileged role (fail closed), never `Role.Editor`. The fallback is
 *  unreachable under V16's `CHECK (role IN ('viewer', 'editor'))`, so this spec owns a PRIVATE embedded
 *  cluster (it alters the schema, so it must not share one) and drops that constraint, simulating a
 *  future migration that widens the set of stored roles before the code learns the new one.
 *  Mutation `getOrElse(Role.Viewer)` -> `getOrElse(Role.Editor)` turns it red. */
class ResourcePermissionRoleFallbackSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: ResourcePermissionRepository = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new ResourcePermissionRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  /** The V16 role CHECK is unnamed, so its generated name is looked up from `pg_constraint`, never assumed. */
  private def dropRoleCheck(): Unit = {
    val names = await(db.run(
      sql"""SELECT conname FROM pg_constraint
            WHERE conrelid = 'resource_permissions'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%role%'""".as[String]
    ))
    names should have size 1
    await(db.run(sqlu"""ALTER TABLE resource_permissions DROP CONSTRAINT #${names.head}"""))
  }

  "ResourcePermissionRepository.findGrant" should {

    "read a stored role the code does not know as Viewer, never Editor" in {
      val granteeId = UUID.randomUUID().toString
      val resource  = UUID.randomUUID().toString
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, ${s"grantee-$granteeId@helio.test"}, now())"""))

      // With the V16 CHECK in place the unknown role cannot be stored at all (it is the reason the arm is unreachable in production).
      an[Exception] should be thrownBy await(db.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $resource, $granteeId::uuid, 'owner', now())"""
      ))

      dropRoleCheck()
      await(db.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $resource, $granteeId::uuid, 'owner', now())"""
      ))

      val grant = await(repo.findGrant("dashboard", resource, UserId(granteeId)))
      grant.map(g => (g.resourceType, g.resourceId, g.granteeId, g.role)) shouldBe
        Some(("dashboard", resource, Some(UserId(granteeId)), Role.Viewer))
    }
  }
}
