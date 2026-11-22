package com.helio.api.routes.pipelines

import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSource => DomainSource}
import com.helio.domain.{FilterCondition, FilterConfig, JoinConfig, SelectConfig}
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testsupport.{ContextAnalyzeApiFixture, CountingDataSource}
import spray.json._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import scala.collection.immutable.AbstractMap
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1625 task 4.4: the statement count of `GET /api/pipelines/context-analyze` does not grow with the number of
 *  pipelines (10 vs 200 of the same shape), and one pipeline whose analysis fails is omitted without failing the rest. */
class PipelineContextAnalyzeQueryCountSpec extends ContextAnalyzeApiFixture {

  private val appCount  = new AtomicInteger(0)
  private val privCount = new AtomicInteger(0)

  override protected def wrapPool(role: Option[String], ds: DataSource): DataSource = role match {
    case Some("helio_app_test")   => CountingDataSource.wrap(ds, appCount)
    case Some("helio_privileged") => CountingDataSource.wrap(ds, privCount)
    case _                        => ds
  }

  /** Reading ONE secondary source by id throws for this id, as a per-pipeline analysis fault would. */
  private val PoisonId = "00000000-0000-0000-0000-00000000dead"

  private final class PoisonedMap(inner: Map[DataSourceId, DomainSource]) extends AbstractMap[DataSourceId, DomainSource] {
    override def get(k: DataSourceId): Option[DomainSource] =
      if (k.value == PoisonId) throw new IllegalStateException("injected per-pipeline fault") else inner.get(k)
    override def iterator: Iterator[(DataSourceId, DomainSource)] = inner.iterator
    override def removed(k: DataSourceId): Map[DataSourceId, DomainSource] = new PoisonedMap(inner - k)
    override def updated[V1 >: DomainSource](k: DataSourceId, v: V1): Map[DataSourceId, V1] = inner.updated(k, v)
  }

  override protected def dataSourceRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): DataSourceRepository =
    new DataSourceRepository(ctx)(ec) {
      override def findByIdsOwned(ids: Set[DataSourceId], user: AuthenticatedUser): Future[Map[DataSourceId, DomainSource]] =
        super.findByIdsOwned(ids, user).map(m => new PoisonedMap(m))
      override def findByIdsInternal(ids: Set[DataSourceId]): Future[Map[DataSourceId, DomainSource]] =
        super.findByIdsInternal(ids).map(m => new PoisonedMap(m))
    }

  /** `n` same-shaped pipelines: a root, a join on a secondary source, an upsert to a dataset, a filter. */
  private def seedShape(n: Int): Unit = {
    reset()
    val ref     = seedSource(userA, "ref", schema = RefSchema)
    val dataset = seedSource(userA, "dataset", kind = "dataset")
    (1 to n).foreach { i =>
      val src = seedSource(userA, s"orders-$i")
      val (pid, Vector(root)) = seedPipeline(userA, s"p$i", Vector(src))
      val j = addStep(pid, "join", JoinConfig(SecondaryInput.Source(ref), "order_id", "inner"), root = Some(root))
      val f = addStep(pid, "filter", FilterConfig("AND", Vector(FilterCondition("amount", "gt", Some("1")))), parent = Some(j))
      addStep(pid, "upsertsource", upsertTo(dataset), parent = Some(f))
    }
  }

  /** (app pool executes, privileged pool executes) for ONE request, after a warm-up request. */
  private def measure(): (Int, Int) = {
    contextAnalyze(userA)
    appCount.set(0); privCount.set(0)
    contextAnalyze(userA)
    (appCount.get, privCount.get)
  }

  "GET /api/pipelines/context-analyze" should {

    "execute the same number of statements for 10 and for 200 pipelines of the same shape" in {
      seedShape(10)
      val small = measure()
      contextItems(userA) should have size 10
      seedShape(200)
      val large = measure()
      contextItems(userA) should have size 200
      info(s"statements at 10 pipelines: app=${small._1} privileged=${small._2}; at 200: app=${large._1} privileged=${large._2}")
      large shouldBe small
      (large._1 + large._2) should be <= 16
    }

    "omit a pipeline whose analysis fails, return the others, and answer 200" in {
      reset()
      val ref = seedSource(userA, "ref", schema = RefSchema)
      val ok  = seedPipeline(userA, "ok", Vector(seedSource(userA, "s1")))
      addStep(ok._1, "join", JoinConfig(SecondaryInput.Source(ref), "order_id", "inner"), root = Some(ok._2.head))
      val bad = seedPipeline(userA, "bad", Vector(seedSource(userA, "s2")))
      addStep(bad._1, "join", JoinConfig(SecondaryInput.Source(PoisonId), "order_id", "inner"), root = Some(bad._2.head))
      val ok2 = seedPipeline(userA, "ok2", Vector(seedSource(userA, "s3")))
      addStep(ok2._1, "select", SelectConfig(Vector("order_id")), root = Some(ok2._2.head))

      val ids = contextItems(userA).map(_.fields("pipelineId").convertTo[String])
      ids shouldBe listedIds(userA).filter(Set(ok._1, ok2._1))
      ids.toSet shouldBe Set(ok._1, ok2._1)
      listedIds(userA) should contain(bad._1)
    }
  }
}
