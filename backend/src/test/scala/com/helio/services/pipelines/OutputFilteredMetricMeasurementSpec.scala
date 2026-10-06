package com.helio.services.pipelines

import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.OutputHistoryApiHarness
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1326 design.md D3 measurement -- NOT a gate and OPT-IN: it runs only with `HELIO_MEASURE=1`
 *  (`HELIO_MEASURE=1 sbt "testOnly *OutputFilteredMetricMeasurementSpec"`), so `sbt testFull`/CI never
 *  start its 120k-row embedded Postgres. It measures what the filtered full-set metric adds to the
 *  rows service path (`OutputService.rows`): the same filtered page+count call against a TABLE Output
 *  (no metric) versus a METRIC Output on the same node, median of 20 each. Pass criterion
 *  (self-set): added time <= 500 ms on a node with >= 100k rows and a filter matching >= 50k. */
class OutputFilteredMetricMeasurementSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private val enabled          = sys.env.get("HELIO_MEASURE").contains("1")
  private val NodeRows         = 120000
  private val MatchingRows     = NodeRows / 2
  private val BarMillis        = 500L

  private var ownerId: String = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    if (enabled) { startHarness(); ownerId = seedUser() }
  }
  override def afterAll(): Unit = { if (enabled) stopHarness(); super.afterAll() }

  private def median(xs: Seq[Long]): Long = xs.sorted.apply(xs.size / 2)

  "the filtered full-set metric on a 120k-row node (50% matching)" should {
    "add no more than 500 ms (median of 20) to the rows service path" in {
      assume(enabled, "set HELIO_MEASURE=1 to run this measurement")
      val (pid, _) = seedPipelineWithOutput(ownerId)
      awaitDb(db.run(sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id)
        SELECT $pid, NULL, g, jsonb_build_object('region', CASE WHEN g % 2 = 0 THEN 'east' ELSE 'west' END, 'amount', g + 1), $pid
        FROM generate_series(0, ${NodeRows - 1}) AS g"""))
      val schema = Vector(SchemaField("region", "string"), SchemaField("amount", "integer"))
      val cfg    = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}}""".parseJson.asJsObject
      val table  = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, UserId(ownerId), "t", OutputKind.Table, JsObject.empty, schema, explicitRootId = Some(PipelineRootId(pid))))
      val metric = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, UserId(ownerId), "m", OutputKind.Metric, cfg, schema, explicitRootId = Some(PipelineRootId(pid))))
      val svc    = new OutputService(outputRepo, panelRepo, accessChecker, nodeSnapshotRepo = snapshotRepo)(harnessEc)
      val user   = AuthenticatedUser(UserId(ownerId))
      val filter = Some(OutputRowsQuery.FilterParam(None, Map.empty, Vector(OutputRowsQuery.OpsTerm.Eq("region", "east"))))

      def timed(id: OutputId): (Long, Option[JsValue]) = {
        val t0 = System.nanoTime()
        val r  = awaitDb(svc.rows(id, Page(0, 200), user, None, filter)).toOption.get
        (((System.nanoTime() - t0) / 1000000), r.metric)
      }
      (1 to 3).foreach { _ => timed(table.id); timed(metric.id) } // warm-up, discarded
      val tableMs  = (1 to 20).map(_ => timed(table.id)._1)
      val metricRuns = (1 to 20).map(_ => timed(metric.id))
      val metricMs = metricRuns.map(_._1)
      // East rows are the even g with amount g + 1, i.e. the odd numbers below NodeRows: they sum to (NodeRows / 2)^2.
      metricRuns.head._2.map(_.asJsObject.fields("value")) shouldBe Some(JsNumber(BigDecimal(MatchingRows) * MatchingRows))
      val added = median(metricMs) - median(tableMs)
      // scalastyle:off println
      println(
        s"""[HEL-1326 measure] node rows=$NodeRows matching=$MatchingRows page=200, median of 20 calls
           |[HEL-1326 measure] rows without metric (table Output): median=${median(tableMs)}ms
           |[HEL-1326 measure] rows with metric (metric Output):   median=${median(metricMs)}ms
           |[HEL-1326 measure] added by the filtered full-set metric: ${added}ms (bar: <= ${BarMillis}ms)""".stripMargin
      )
      added should be <= BarMillis
    }
  }
}
