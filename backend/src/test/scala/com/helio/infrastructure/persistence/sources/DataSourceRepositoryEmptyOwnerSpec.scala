package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.UserSeeding
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1433 D1: `data_sources.owner_id` is a non-optional `UUID` in Slick, so turning a `DataSource`'s owner into the
 *  row's `UUID` can throw (an empty or malformed owner). Before HEL-1433 an empty owner became a NULL insert that the
 *  database rejected, i.e. a FAILED FUTURE. The conversion is therefore deferred into the DBIO chain; evaluated eagerly
 *  it would throw synchronously out of the repository method (`DbContext.withUserContext` takes its action by value).
 *
 *  Each test captures the Future INSIDE `noException should be thrownBy`, so a synchronous throw fails it as a thrown
 *  exception rather than being swallowed by a later `intercept` on the Future.
 */
class DataSourceRepositoryEmptyOwnerSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: DataSourceRepository         = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataSourceRepository(new DbContext(db, db))
    UserSeeding.seedUsers(db, owner)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)
  private def rowCount(): Int =
    await(db.run(sql"SELECT count(*) FROM data_sources".as[Int])).head

  private def datasetSource(ownerId: UserId): DatasetSource = {
    val now = Instant.now()
    DatasetSource(DataSourceId(UUID.randomUUID().toString), "empty-owner", ownerId, now, now)
  }

  "DataSourceRepository with an empty owner" should {

    "answer insert with a failed Future (never a synchronous throw) and write no row" in {
      val before = rowCount()
      var future: Future[DataSource] = null
      noException should be thrownBy { future = repo.insert(datasetSource(UserId("")), user) }
      an[IllegalArgumentException] should be thrownBy await(future)
      rowCount() shouldBe before
    }

    "answer insertDatasetSource with a failed Future (never a synchronous throw) and write no row" in {
      val before = rowCount()
      var future: Future[DataSource] = null
      noException should be thrownBy {
        future = repo.insertDatasetSource(datasetSource(UserId("")), Vector.empty, Vector.empty, Vector.empty, user)
      }
      an[IllegalArgumentException] should be thrownBy await(future)
      rowCount() shouldBe before
    }

    "still insert a source with a valid owner (the deferral changes only the failure mode)" in {
      val before = rowCount()
      val source = datasetSource(owner)
      await(repo.insert(source, user)).id shouldBe source.id
      rowCount() shouldBe before + 1
    }
  }
}
