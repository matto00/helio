package com.helio.testsupport

import com.helio.domain.{FilterCondition, FilterConfig, JoinConfig, LookupConfig, RenameConfig, SelectConfig}
import com.helio.domain.model.{PipelineId, PipelineRootId, PipelineStepId}
import com.helio.domain.steps.{SecondaryInput, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.collection.mutable.LinkedHashMap

/** HEL-1625: seeding and read helpers shared by the `GET /api/pipelines/context-analyze` specs, on top of the
 *  non-BYPASSRLS `TwoUserRlsApiFixture`. Everything is seeded on the privileged pool; every read goes through
 *  the real route tree as a signed-in user. */
abstract class ContextAnalyzeApiFixture extends TwoUserRlsApiFixture {

  protected lazy val stepRepo = new PipelineStepRepository(ctx)(executor)

  protected val OrdersSchema = """[{"name":"order_id","type":"string"},{"name":"amount","type":"float"},{"name":"region","type":"string"}]"""
  protected val RefSchema    = """[{"name":"order_id","type":"integer"},{"name":"label","type":"string"}]"""

  protected def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE pipelines, data_sources CASCADE"))

  protected def seedSource(owner: String, name: String, kind: String = "csv", schema: String = OrdersSchema): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
             VALUES ($id::uuid, $name, $kind, '{"path":"x.csv"}'::jsonb, $owner::uuid, $schema::jsonb, now(), now())"""
    ))
    id
  }

  /** A pipeline with one root per source id; returns (pipelineId, rootIds). Pipelines created later list later. */
  protected def seedPipeline(owner: String, name: String, rootSources: Vector[String]): (String, Vector[String]) = {
    val id      = UUID.randomUUID().toString
    val rootIds = Vector.fill(rootSources.size)(UUID.randomUUID().toString)
    await(privilegedDb.run(DBIO.seq(
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, $name, $owner::uuid, now(), now())",
      DBIO.seq(rootIds.zip(rootSources).zipWithIndex.map { case ((rootId, src), i) =>
        sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootId, $id, $src::uuid, $i)"
      }: _*)
    )))
    (id, rootIds)
  }

  protected def addStep(pipeline: String, kind: String, config: Any, root: Option[String] = None, parent: Option[String] = None, enabled: Boolean = true): String =
    await(stepRepo.insertInternal(
      PipelineId(pipeline), kind, config, enabled,
      parentStepId = parent.map(PipelineStepId(_)), explicitRootId = root.map(PipelineRootId(_)),
      // an existing-source upsert is cycle-checked as the acting user: the pipeline owner
      actingUserId = await(privilegedDb.run(sql"SELECT owner_id::text FROM pipelines WHERE id = $pipeline".as[String])).head
    )).id.value

  protected def grant(pipelineId: String, grantee: String, role: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, $grantee::uuid, $role, now())"""
    ))

  protected def upsertTo(targetId: String): UpsertSourceConfig = UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), "append")

  protected def getJson(path: String, user: String): JsValue =
    req(HttpMethods.GET, path, user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson
    }

  protected def contextAnalyze(user: String): JsObject = getJson("/api/pipelines/context-analyze", user).asJsObject
  protected def contextItems(user: String): Vector[JsObject] = contextAnalyze(user).fields("items").convertTo[Vector[JsObject]]
  protected def analyzeOf(pipelineId: String, user: String): JsObject = getJson(s"/api/pipelines/$pipelineId/analyze", user).asJsObject
  protected def listedIds(user: String): Vector[String] =
    getJson("/api/pipelines", user).convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String])

  /** The pipelines of the rich parity fixture, each exercising one case the spec requires; returns name -> pipeline id. */
  protected def seedRichPipelines(owner: String, other: String): Map[String, String] = {
    val orders  = seedSource(owner, "orders-a")
    val orders2 = seedSource(owner, "orders-a2")
    val ref     = seedSource(owner, "ref-a", schema = RefSchema)
    val dataset = seedSource(owner, "dataset-a", kind = "dataset")
    val csvTgt  = seedSource(owner, "csv-target-a")
    val foreign = seedSource(other, "dataset-foreign", kind = "dataset")
    val foreignRoot = seedSource(other, "orders-foreign")
    val names   = LinkedHashMap.empty[String, String]

    // multi-root, branched (two children of the first filter), unique positions
    val (multi, Vector(r1, r2)) = seedPipeline(owner, "multi-root", Vector(orders, orders2))
    val f = addStep(multi, "filter", FilterConfig("AND", Vector(FilterCondition("amount", "gt", Some("1")))), root = Some(r1))
    addStep(multi, "select", SelectConfig(Vector("order_id", "amount")), parent = Some(f))
    addStep(multi, "rename", RenameConfig(Map("region" -> "area")), parent = Some(f))
    addStep(multi, "select", SelectConfig(Vector("order_id")), root = Some(r2))
    names("multi-root") = multi

    // a disabled step in the middle of a chain
    val (disabled, Vector(rd)) = seedPipeline(owner, "disabled", Vector(orders))
    val dr = addStep(disabled, "rename", RenameConfig(Map("order_id" -> "id")), root = Some(rd), enabled = false)
    addStep(disabled, "select", SelectConfig(Vector("amount")), parent = Some(dr))
    names("disabled") = disabled

    // a step with a validationError (unsupported join type)
    val (invalid, Vector(ri)) = seedPipeline(owner, "invalid-config", Vector(orders))
    addStep(invalid, "join", JoinConfig(SecondaryInput.Source(ref), "order_id", "bogus_type"), root = Some(ri))
    names("invalid-config") = invalid

    // join + lookup reading a secondary source (type mismatch string vs integer gives warnings)
    val (sec, Vector(rs)) = seedPipeline(owner, "join-lookup", Vector(orders))
    val j = addStep(sec, "join", JoinConfig(SecondaryInput.Source(ref), "order_id", "inner"), root = Some(rs))
    addStep(sec, "lookup", LookupConfig(SecondaryInput.Source(ref), "order_id", "order_id", Vector("label")), parent = Some(j))
    names("join-lookup") = sec

    // upsertsource: ok dataset target, missing target, a foreign user's dataset, a csv (not a dataset)
    val (ups, Vector(ru)) = seedPipeline(owner, "upserts", Vector(orders))
    val u1 = addStep(ups, "upsertsource", upsertTo(dataset), root = Some(ru))
    val u2 = addStep(ups, "upsertsource", upsertTo(UUID.randomUUID().toString), parent = Some(u1))
    val u3 = addStep(ups, "upsertsource", upsertTo(foreign), parent = Some(u2))
    addStep(ups, "upsertsource", upsertTo(csvTgt), parent = Some(u3))
    names("upserts") = ups

    // non-blocking warnings: a filter on a column the input does not have
    val (warn, Vector(rw)) = seedPipeline(owner, "warnings", Vector(orders))
    addStep(warn, "filter", FilterConfig("AND", Vector(FilterCondition("no_such_column", "eq", Some("x")))), root = Some(rw))
    names("warnings") = warn

    // a second root whose source the caller does not own (a root-as-caller read sees no schema for it)
    val (foreignRootP, Vector(rf1, rf2)) = seedPipeline(owner, "foreign-root", Vector(orders, foreignRoot))
    addStep(foreignRootP, "select", SelectConfig(Vector("order_id")), root = Some(rf1))
    addStep(foreignRootP, "select", SelectConfig(Vector("order_id")), root = Some(rf2))
    names("foreign-root") = foreignRootP

    val (empty, _) = seedPipeline(owner, "zero-steps", Vector(orders))
    names("zero-steps") = empty
    names.toMap
  }
}
