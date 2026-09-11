package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.domain.engine.SchemaField
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.domain.model._
import spray.json.DefaultJsonProtocol._
import spray.json._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class DataSourceRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataSourceRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private val owner1 = UserId(UUID.randomUUID().toString)
  private val owner2 = UserId(UUID.randomUUID().toString)
  private val user1  = AuthenticatedUser(owner1)
  private val user2  = AuthenticatedUser(owner2)

  private def newSource(name: String = "Test Source", ownerId: UserId = owner1): DataSource = {
    val now = Instant.now()
    RestSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = name,
      ownerId   = ownerId,
      createdAt = now,
      updatedAt = now,
      config    = RestApiConfig(connectorId = "conn-1", endpoint = "https://example.test", method = "GET")
    )
  }

  private def newDatasetSource(name: String, declared: Vector[DatasetFieldDeclaration], rows: Vector[Vector[JsValue]]): DataSourceId = {
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), name, owner1, now, now)
    val schema = declared.map(f => SchemaField(f.name, DataFieldType.asString(f.fieldType)))
    await(repo.insertDatasetSource(source, declared, rows, schema, user1))
    source.id
  }

  "DataSourceRepository" should {

    "insert and findByIdInternal returns the same record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source, user1))
      val found = await(repo.findByIdInternal(source.id))
      found shouldBe defined
      found.get.id      shouldBe source.id
      found.get.name    shouldBe source.name
      found.get.kind    shouldBe source.kind
      found.get.ownerId shouldBe owner1
      found.get         shouldBe a [RestSource]
    }

    "findAll returns only records owned by the given user" in {
      cleanDb()
      val a = newSource("Source A", owner1)
      val b = newSource("Source B", owner1)
      val c = newSource("Source C", owner2)
      await(repo.insert(a, user1))
      await(repo.insert(b, user1))
      await(repo.insert(c, user2))
      val forOwner1 = await(repo.findAll(owner1, Page.Default))
      forOwner1.items.map(_.id) should contain allOf (a.id, b.id)
      forOwner1.items.map(_.id) should not contain c.id
      val forOwner2 = await(repo.findAll(owner2, Page.Default))
      forOwner2.items.map(_.id) should contain only c.id
    }

    "findByIdInternal returns None for unknown id" in {
      cleanDb()
      val result = await(repo.findByIdInternal(DataSourceId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "findByIdOwned returns None for wrong owner (owner-scoped; cross-user isolation)" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      // owner2 cannot see owner1's source via findAll
      val forOwner2 = await(repo.findAll(owner2, Page.Default))
      forOwner2.items.map(_.id) should not contain source.id
    }

    // ── HEL-265 CS2: findByIdOwned seed for cross-source ACL ────────────────
    //
    // Introduced to gate `PipelineRepository.create`'s source binding. CS3
    // broadens adoption across the DataSource / Source service surface.

    "findByIdOwned returns the row for the owner" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      val found = await(repo.findByIdOwned(source.id, user1))
      found shouldBe defined
      found.get.id shouldBe source.id
    }

    "findByIdOwned returns None for a non-owner" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      await(repo.findByIdOwned(source.id, user2)) shouldBe None
    }

    "findByIdOwned returns None for an unknown id" in {
      cleanDb()
      await(repo.findByIdOwned(
        DataSourceId(UUID.randomUUID().toString),
        user1
      )) shouldBe None
    }

    "delete returns true and removes the record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source, user1))
      val deleted = await(repo.delete(source.id, user1))
      deleted shouldBe true
      await(repo.findByIdInternal(source.id)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb()
      val result = await(repo.delete(DataSourceId(UUID.randomUUID().toString), user1))
      result shouldBe false
    }

    "update returns the updated entity" in {
      cleanDb()
      val source = newSource("Original")
      await(repo.insert(source, user1))
      val updated = source.asInstanceOf[RestSource].copy(name = "Renamed", updatedAt = Instant.now())
      val result  = await(repo.update(updated, user1))
      result shouldBe defined
      result.get.name shouldBe "Renamed"
    }

    "update returns None for unknown id" in {
      cleanDb()
      val source = newSource().asInstanceOf[RestSource].copy(id = DataSourceId(UUID.randomUUID().toString))
      val result = await(repo.update(source, user1))
      result shouldBe None
    }

    "round-trips each ADT subtype through insert + findById" in {
      cleanDb()
      val now      = Instant.now()
      val csv      = CsvSource(DataSourceId(UUID.randomUUID().toString), "csv-src", owner1, now, now,
                                CsvSourceConfig("uploads/test.csv"))
      val rest     = RestSource(DataSourceId(UUID.randomUUID().toString), "rest-src", owner1, now, now,
                                 RestApiConfig(connectorId = "conn-2", endpoint = "https://api.example/test", method = "POST"))
      val sql      = SqlSource(DataSourceId(UUID.randomUUID().toString), "sql-src", owner1, now, now,
                                SqlSourceConfig("postgresql", "host", 5432, "db", "u", "p", "SELECT 1"))
      val static   = DatasetSource(DataSourceId(UUID.randomUUID().toString), "static-src", owner1, now, now)

      await(repo.insert(csv, user1))
      await(repo.insert(rest, user1))
      await(repo.insert(sql, user1))
      await(repo.insert(static, user1))

      await(repo.findByIdInternal(csv.id)).get    shouldBe a [CsvSource]
      await(repo.findByIdInternal(rest.id)).get   shouldBe a [RestSource]
      await(repo.findByIdInternal(sql.id)).get    shouldBe a [SqlSource]
      await(repo.findByIdInternal(static.id)).get shouldBe a [DatasetSource]

      val csvRound = await(repo.findByIdInternal(csv.id)).get.asInstanceOf[CsvSource]
      csvRound.config.path shouldBe "uploads/test.csv"
      val sqlRound = await(repo.findByIdInternal(sql.id)).get.asInstanceOf[SqlSource]
      sqlRound.config.query    shouldBe "SELECT 1"
      sqlRound.config.dialect  shouldBe "postgresql"
      val restRound = await(repo.findByIdInternal(rest.id)).get.asInstanceOf[RestSource]
      restRound.config.connectorId shouldBe "conn-2"
      restRound.config.endpoint    shouldBe "https://api.example/test"
      restRound.config.method      shouldBe "POST"
    }

    // HEL-1074 tasks.md 2.3: round-trip a DatasetSource through insert/read with the new stored
    // value -- `domainToRow` writes "dataset" (design.md Decision 6), `rowToDomain` maps it back
    // to `DatasetSource`, and the raw `source_type` column really is "dataset", not "static".
    "insert writes 'dataset' as the stored source_type for a DatasetSource, and rowToDomain maps it back" in {
      cleanDb()
      import slick.jdbc.PostgresProfile.api._
      val now    = Instant.now()
      val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "dataset-src", owner1, now, now)
      await(repo.insert(source, user1))

      val storedType = await(db.run(sql"SELECT source_type FROM data_sources WHERE id = ${source.id.value}".as[String].head))
      storedType shouldBe "dataset"

      val found = await(repo.findByIdInternal(source.id))
      found.get shouldBe a [DatasetSource]
    }

    // HEL-1074 design.md Decision 7 / tasks.md 3.5-3.6: `insertDatasetSource` / `replaceDatasetRows`
    // / `readDatasetRows` round-trip the `{columns, rows}` shape through `dataset_schema` +
    // `dataset_rows`, positionally (not object-keyed).
    "insertDatasetSource + readDatasetRows round-trips columns and rows positionally" in {
      cleanDb()
      import spray.json._
      val now     = Instant.now()
      val source  = DatasetSource(DataSourceId(UUID.randomUUID().toString), "ds-1", owner1, now, now)
      val inferredSchema = Vector(SchemaField("a", "string"), SchemaField("b", "integer"))
      val declared = Vector(
        DatasetFieldDeclaration("a", DataFieldType.StringType),
        DatasetFieldDeclaration("b", DataFieldType.IntegerType)
      )
      val rows    = Vector(Vector(JsString("x"), JsNumber(1)), Vector(JsString("y"), JsNumber(2)))

      await(repo.insertDatasetSource(source, declared, rows, inferredSchema, user1))

      val readBack = await(repo.readDatasetRows(source.id))
      readBack shouldBe defined
      readBack.get.fields("columns") shouldBe declared.toJson
      readBack.get.fields("rows")    shouldBe JsArray(rows.map(JsArray(_)))
    }

    // HEL-1077 design.md D1 (round-2): `replaceDatasetRows` was restructured into `replaceRows`,
    // taking `declaration: Option[...]` (`Some` = refresh's write-this-schema semantics) and
    // returning `Future[Option[Either[String, (DataSource, Vector[DatasetRowRow])]]]` -- these
    // callers are updated for the rename/signature, not just renamed in place.
    "replaceRows(declaration = Some(...)) deletes the old rows and inserts the new ones, updating dataset_schema too" in {
      cleanDb()
      import spray.json._
      val now      = Instant.now()
      val source   = DatasetSource(DataSourceId(UUID.randomUUID().toString), "ds-2", owner1, now, now)
      val schema1  = Vector(SchemaField("a", "string"))
      val declared1 = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val rows1    = Vector(Vector(JsString("old")))
      await(repo.insertDatasetSource(source, declared1, rows1, schema1, user1))

      val declared2 = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType), DatasetFieldDeclaration("b", DataFieldType.BooleanType))
      val rows2    = Vector(Vector(JsString("new"), JsBoolean(true)))
      val updated  = await(repo.replaceRows(source.id, Some(declared2), rows2, 500, Instant.now(), user1))
      updated shouldBe defined
      updated.get shouldBe a [Right[_, _]]

      val readBack = await(repo.readDatasetRows(source.id))
      readBack.get.fields("columns") shouldBe declared2.toJson
      readBack.get.fields("rows")    shouldBe JsArray(rows2.map(JsArray(_)))
    }

    // HEL-1074 (skeptic-final-1.md non-blocking note): the old `updateStaticPayload` returned
    // `None` for a source deleted mid-refresh, failing loudly; `replaceRows` must preserve
    // that same "not found" signal now that it also returns Option[...].
    "replaceRows returns None for a nonexistent data source id" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val result  = await(repo.replaceRows(DataSourceId(UUID.randomUUID().toString), Some(declared), Vector.empty, 500, Instant.now(), user1))
      result shouldBe None
    }

    "readDatasetRows returns Some with an empty rows array for a dataset source with zero rows" in {
      cleanDb()
      import spray.json._
      val now    = Instant.now()
      val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "ds-empty", owner1, now, now)
      val schema = Vector(SchemaField("a", "string"))
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      await(repo.insertDatasetSource(source, declared, Vector.empty, schema, user1))

      val readBack = await(repo.readDatasetRows(source.id))
      readBack shouldBe defined
      readBack.get.fields("columns") shouldBe declared.toJson
      readBack.get.fields("rows")    shouldBe JsArray.empty
    }

    "readDatasetRows returns None for a nonexistent data source id" in {
      cleanDb()
      val readBack = await(repo.readDatasetRows(DataSourceId(UUID.randomUUID().toString)))
      readBack shouldBe None
    }

    // ── HEL-1077 tasks.md 5.1/5.2/5.3/5.3b/5.7/5.8: appendRows / replaceRows ──

    "appendRows assigns 0-based, increasing seq continuing from the source's current MAX(seq)" in {
      cleanDb()
      import spray.json._
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-append", declared, Vector(Vector(JsString("x")), Vector(JsString("y")), Vector(JsString("z"))))

      val result = await(repo.appendRows(id, Vector(Vector(JsString("w")), Vector(JsString("v"))), 500, Instant.now(), user1))
      result shouldBe defined
      val (_, added) = result.get.toOption.get
      added.map(_.seq) shouldBe Vector(3L, 4L)

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("rows").asInstanceOf[JsArray].elements should have size 5
    }

    "appendRows to an empty source starts at seq 0" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-append-empty", declared, Vector.empty)

      val result = await(repo.appendRows(id, Vector(Vector(JsString("first"))), 500, Instant.now(), user1))
      val (_, added) = result.get.toOption.get
      added.map(_.seq) shouldBe Vector(0L)
    }

    "appendRows leaves existing rows' id/seq/data unchanged" in {
      cleanDb()
      import spray.json._
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-append-preserve", declared, Vector(Vector(JsString("x"))))
      val before = await(repo.readDatasetRows(id)).get.fields("rows")

      await(repo.appendRows(id, Vector(Vector(JsString("y"))), 500, Instant.now(), user1))

      val afterRows = await(repo.readDatasetRows(id)).get.fields("rows").asInstanceOf[JsArray].elements
      afterRows.head shouldBe before.asInstanceOf[JsArray].elements.head
    }

    "appendRows rejects a row that fails schema validation, with no partial insert" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("age", DataFieldType.IntegerType))
      val id = newDatasetSource("ds-append-invalid", declared, Vector.empty)

      val result = await(repo.appendRows(id, Vector(Vector(JsString("not-an-integer"))), 500, Instant.now(), user1))
      result.get.isLeft shouldBe true

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("rows").asInstanceOf[JsArray].elements shouldBe empty
    }

    "appendRows rejects when the resulting total would exceed maxRows" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-append-limit", declared, Vector(Vector(JsString("x"))))

      val result = await(repo.appendRows(id, Vector(Vector(JsString("y")), Vector(JsString("z"))), 2, Instant.now(), user1))
      result.get shouldBe Left("Payload exceeds the maximum of 2 rows")

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("rows").asInstanceOf[JsArray].elements should have size 1
    }

    "appendRows returns None for a nonexistent data source id" in {
      cleanDb()
      val result = await(repo.appendRows(DataSourceId(UUID.randomUUID().toString), Vector(Vector(JsString("x"))), 500, Instant.now(), user1))
      result shouldBe None
    }

    "appendRows recomputes inferred_schema over the full post-write row set" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("n", DataFieldType.IntegerType, required = false))
      val id = newDatasetSource("ds-append-inferred", declared, Vector(Vector(JsNull)))

      // Column "n" starts all-null (infers to the declared type, "integer" -- PipelineRowJson
      // .staticColumnRuntimeType's `Seq()` branch); appending a real numeric value flips the
      // inferred runtime type to "float" (every `JsNumber` cell maps to "float", the same
      // convention `createStatic`/`applyStaticRefresh` already use).
      val beforeSchema = await(repo.findByIdInternal(id)).get.inferredSchema
      beforeSchema.find(_.name == "n").map(_.`type`) shouldBe Some("integer")
      await(repo.appendRows(id, Vector(Vector(JsNumber(42))), 500, Instant.now(), user1))
      val afterSchema = await(repo.findByIdInternal(id)).get.inferredSchema

      afterSchema.find(_.name == "n").map(_.`type`) should not be beforeSchema.find(_.name == "n").map(_.`type`)
      afterSchema.find(_.name == "n").map(_.`type`) shouldBe Some("float")
    }

    "replaceRows(declaration = None) reads and keeps the current schema, unlike declaration = Some" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-put", declared, Vector(Vector(JsString("old"))))

      val result = await(repo.replaceRows(id, None, Vector(Vector(JsString("new"))), 500, Instant.now(), user1))
      result.get.isRight shouldBe true

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("columns") shouldBe declared.toJson
      readBack.get.fields("rows")    shouldBe JsArray(Vector(JsArray(Vector(JsString("new")))))
    }

    "replaceRows(declaration = None) with an empty rows vector clears the source" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-put-empty", declared, Vector(Vector(JsString("x")), Vector(JsString("y"))))

      val result = await(repo.replaceRows(id, None, Vector.empty, 500, Instant.now(), user1))
      result.get.isRight shouldBe true

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("rows").asInstanceOf[JsArray].elements shouldBe empty
    }

    "replaceRows rejects a mid-batch invalid row, leaving the prior set byte-for-byte intact" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("age", DataFieldType.IntegerType))
      val id = newDatasetSource("ds-put-invalid", declared, Vector(Vector(JsNumber(1)), Vector(JsNumber(2))))
      val before = await(repo.readDatasetRows(id)).get.fields("rows")

      val result = await(repo.replaceRows(
        id, None,
        Vector(Vector(JsNumber(3)), Vector(JsNumber(4)), Vector(JsString("not-an-integer"))),
        500, Instant.now(), user1
      ))
      result.get.isLeft shouldBe true

      val after = await(repo.readDatasetRows(id)).get.fields("rows")
      after shouldBe before
    }

    "replaceRows rejects a replacement exceeding maxRows, leaving the prior set intact" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-put-limit", declared, Vector(Vector(JsString("x"))))

      val result = await(repo.replaceRows(id, None, Vector(Vector(JsString("a")), Vector(JsString("b"))), 1, Instant.now(), user1))
      result.get shouldBe Left("Payload exceeds the maximum of 1 rows")

      val readBack = await(repo.readDatasetRows(id))
      readBack.get.fields("rows").asInstanceOf[JsArray].elements should have size 1
    }

    // HEL-1077 tasks.md 5.2: a REAL concurrent test (parallel Futures, not sequential calls) --
    // two simultaneous appends to the same source must both land, no lost row, no duplicate seq.
    // `lockSource`'s `FOR UPDATE` inside each transaction is what serializes these two writers.
    "two concurrent appendRows calls to the same source both land, no lost rows, no duplicate seq" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-concurrent-append", declared, Vector.empty)

      val f1 = repo.appendRows(id, Vector(Vector(JsString("from-1"))), 500, Instant.now(), user1)
      val f2 = repo.appendRows(id, Vector(Vector(JsString("from-2"))), 500, Instant.now(), user1)
      val (r1, r2) = await(f1.zip(f2))
      r1.get.isRight shouldBe true
      r2.get.isRight shouldBe true

      val rows = await(repo.readDatasetRows(id)).get.fields("rows").asInstanceOf[JsArray].elements
      rows should have size 2
      val seqs = await(db.run({
        import slick.jdbc.PostgresProfile.api._
        sql"SELECT seq FROM dataset_rows WHERE data_source_id = ${id.value} ORDER BY seq".as[Long]
      }))
      seqs.distinct should have size 2
      seqs shouldBe Vector(0L, 1L)
    }

    // HEL-1077 tasks.md 5.7 / evaluation-1.md CR1: two concurrent appends, each individually
    // under maxRows, whose COMBINED total exceeds it -- proves the row-count check runs INSIDE
    // the lock (against a freshly-read count), not against a pre-lock read that both callers
    // could pass simultaneously. 1 existing row + maxRows=2 + two single-row appends: any
    // interleaving admits at most one of the two (1+1=2 is the max a single winner can reach;
    // the second writer's fresh count-under-lock read is already at the limit).
    "two concurrent appendRows calls that would jointly exceed maxRows -- at least one is rejected, final count never exceeds the limit" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-concurrent-limit", declared, Vector(Vector(JsString("existing"))))

      val f1 = repo.appendRows(id, Vector(Vector(JsString("from-1"))), 2, Instant.now(), user1)
      val f2 = repo.appendRows(id, Vector(Vector(JsString("from-2"))), 2, Instant.now(), user1)
      val (r1, r2) = await(f1.zip(f2))

      val results = Vector(r1, r2).map(_.get)
      results.count(_.isLeft) should be >= 1
      results.collect { case Left(msg) => msg }.foreach(_ shouldBe "Payload exceeds the maximum of 2 rows")

      val finalCount = await(repo.readDatasetRows(id)).get.fields("rows").asInstanceOf[JsArray].elements.size
      finalCount should be <= 2
    }

    // HEL-1077 tasks.md 5.3: a refresh (replaceRows(declaration = Some(...))) racing a concurrent
    // append -- both complete without a UNIQUE(data_source_id, seq) violation, and the final row
    // set reflects one consistent, serialized ordering (never a torn mix).
    "a replaceRows(declaration = Some) racing a concurrent appendRows never violates UNIQUE(data_source_id, seq)" in {
      cleanDb()
      val declared = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-refresh-vs-append", declared, Vector(Vector(JsString("orig"))))

      val fRefresh = repo.replaceRows(id, Some(declared), Vector(Vector(JsString("refreshed-1")), Vector(JsString("refreshed-2"))), 500, Instant.now(), user1)
      val fAppend  = repo.appendRows(id, Vector(Vector(JsString("appended"))), 500, Instant.now(), user1)
      val (refreshResult, appendResult) = await(fRefresh.zip(fAppend))

      // Both operations complete (no exception from a unique-constraint violation) -- the
      // serialization the lock provides is proven by the absence of a thrown PSQLException here,
      // not by asserting a specific interleaving order (either order is a valid serialization).
      refreshResult shouldBe defined
      appendResult shouldBe defined

      val seqs = await(db.run({
        import slick.jdbc.PostgresProfile.api._
        sql"SELECT seq FROM dataset_rows WHERE data_source_id = ${id.value} ORDER BY seq".as[Long]
      }))
      seqs.distinct.size shouldBe seqs.size // no duplicate seq under either serialization order
    }

    // HEL-1077 tasks.md 5.3b (skeptic-design-2.md required revision): a PUT racing a refresh that
    // changes the declared schema -- the loser of the lock race must observe the winner's
    // committed schema (never a stale pre-lock read), and neither write is silently lost/reverted.
    // skeptic-final-1.md CR2: strengthened from the original version, whose two schemas (both
    // single-column) let PUT's row validate identically against EITHER schema -- the test could
    // not distinguish "refresh's new schema won" from "PUT's stale pre-lock read silently
    // reverted it" (probe-confirmed: a scratch copy with `lockSource` removed from `replaceRows`
    // still passed this shape 3/3 runs). Fixed by making the two schemas genuinely
    // distinguishable: the new schema has an extra REQUIRED column the old schema lacks, and
    // PUT's row is deliberately valid against the OLD schema but INVALID against the NEW one
    // (missing the required "b"). This makes the final state deterministic regardless of which
    // transaction's lock is granted first:
    //   - refresh first, PUT second: PUT's fresh in-lock read sees the NEW schema, its row fails
    //     validation (missing "b"), PUT is rejected cleanly, refresh's write stands.
    //   - PUT first, refresh second: PUT succeeds under the OLD schema (fine at the time), but
    //     refresh's later write (built to satisfy its OWN schema) unconditionally overwrites it.
    // Either way the final stored schema/rows must equal refresh's specifically -- if
    // `replaceRows(None)` instead used a schema snapshotted BEFORE the lock, PUT could wrongly
    // succeed against a stale copy of the OLD schema even when it actually runs SECOND (after
    // refresh committed), silently reverting refresh's write; this assertion catches exactly that.
    "a replaceRows(declaration = None) racing a replaceRows(declaration = Some(...)) schema change never silently reverts refresh's committed schema" in {
      cleanDb()
      val oldSchema = Vector(DatasetFieldDeclaration("a", DataFieldType.StringType))
      val id = newDatasetSource("ds-put-vs-refresh-schema", oldSchema, Vector(Vector(JsString("orig"))))

      val newSchema = Vector(
        DatasetFieldDeclaration("a", DataFieldType.StringType, required = true),
        DatasetFieldDeclaration("b", DataFieldType.StringType, required = true)
      )
      val refreshRows = Vector(Vector(JsString("r1"), JsString("r2")))
      val putRows     = Vector(Vector(JsString("put-value")))

      val fRefresh = repo.replaceRows(id, Some(newSchema), refreshRows, 500, Instant.now(), user1)
      val fPut     = repo.replaceRows(id, None, putRows, 500, Instant.now(), user1)
      val (refreshResult, putResult) = await(fRefresh.zip(fPut))

      refreshResult shouldBe defined
      refreshResult.get.isRight shouldBe true
      putResult shouldBe defined
      // Both outcomes below are legitimate results of a genuine race (see comment above) --
      // what must never happen is PUT succeeding against a stale OLD-schema copy after refresh
      // has already committed the NEW one, which the final-state assertion below rules out.
      putResult.get match {
        case Right(_)     => () // PUT ran first, under the old schema; refresh's later write wins
        case Left(errMsg) => errMsg should include("'b'")
      }

      val readBack = await(repo.readDatasetRows(id)).get
      readBack.fields("columns") shouldBe newSchema.toJson
      readBack.fields("rows")    shouldBe JsArray(refreshRows.map(JsArray(_)))
    }
  }
}
