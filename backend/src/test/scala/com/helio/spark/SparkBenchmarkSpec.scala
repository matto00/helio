package com.helio.spark

import com.helio.domain._
import org.apache.spark.sql.SparkSession
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}
import scala.util.Random

/**
 * Benchmarking suite for panel query execution against a local Spark session.
 *
 * Establishes p95 < 2s targets for four representative panel query scenarios:
 *   1. Simple column projection (10k rows)
 *   2. Filter + sort (10k rows)
 *   3. Aggregation — group-by + sum (100k rows)
 *   4. Paginated query using PanelQueryExecutor.executePaginated (100k rows)
 *
 * No external infrastructure required — all tests run on a local[*] SparkSession.
 *
 * Benchmark methodology:
 *   - 5 warm-up iterations to allow JVM/Spark class loading stabilisation
 *   - 20 timed samples collected via System.nanoTime
 *   - p95 computed as the 19th element of the sorted sample array (index = ceil(0.95 * 20) - 1)
 */
class SparkBenchmarkSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  // Shared submitter backed by the benchmark SparkSession (initialized in beforeAll)
  private var submitter: SparkJobSubmitter = _
  private var executor: PanelQueryExecutor = _

  private val WARMUP_RUNS  = 5
  private val TIMED_RUNS   = 20
  private val TARGET_P95MS = 2000L

  override def beforeAll(): Unit = {
    super.beforeAll()
    // Initialise the benchmark SparkSession first so that SparkJobSubmitter.spark's
    // lazy getOrCreate() picks it up (with benchmark-appropriate config) rather than
    // creating a new session with production defaults.
    SparkSession
      .builder()
      .appName("helio-benchmark")
      .master("local[*]")
      .config("spark.ui.enabled", "false")
      .config("spark.sql.shuffle.partitions", "2")
      .config("spark.default.parallelism", "2")
      .getOrCreate()

    // We pass null repos since benchmarks use only loadDataFrame / collectRows.
    submitter = new SparkJobSubmitter("local[*]", null, null)
    executor  = new PanelQueryExecutor(submitter)
  }

  override def afterAll(): Unit = {
    try {
      submitter.spark.stop()
    } catch { case _: Throwable => () }
    super.afterAll()
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Run `thunk` for `n` iterations and return elapsed wall-clock times in ms. */
  private def timeSamples(n: Int)(thunk: => Unit): Vector[Long] =
    (1 to n).map { _ =>
      val t0 = System.nanoTime()
      thunk
      (System.nanoTime() - t0) / 1_000_000L
    }.toVector

  /** Compute p95 from a sample vector (rounds up to nearest index). */
  private def p95(samples: Vector[Long]): Long = {
    val sorted = samples.sorted
    sorted(math.ceil(0.95 * sorted.length).toInt - 1)
  }

  /** Create a static DataSource with given column definitions and rows. */
  private def staticDs(
      id: String,
      cols: Seq[(String, String)],
      rows: Seq[Seq[JsValue]]
  ): DataSource = {
    val colJson = JsArray(cols.map { case (n, t) =>
      JsObject("name" -> JsString(n), "type" -> JsString(t))
    }.toVector)
    val rowJson = JsArray(rows.map(r => JsArray(r.toVector)).toVector)
    DataSource(
      id         = DataSourceId(id),
      name       = s"bench-$id",
      sourceType = SourceType.Static,
      config     = JsObject("columns" -> colJson, "rows" -> rowJson),
      createdAt  = Instant.now(),
      updatedAt  = Instant.now(),
      ownerId    = UserId("bench-user")
    )
  }

  /** Synthesise n rows with (id: Int, value: Double, category: String). */
  private def syntheticRows(n: Int, seed: Long = 42L): Seq[Seq[JsValue]] = {
    val rng = new Random(seed)
    val categories = Vector("alpha", "beta", "gamma", "delta")
    (1 to n).map { i =>
      Seq(
        JsNumber(i),
        JsNumber(BigDecimal(rng.nextDouble() * 1000).setScale(2, BigDecimal.RoundingMode.HALF_UP)),
        JsString(categories(i % categories.length))
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  "SparkBenchmarkSpec" when {

    "scenario: simple projection (10k rows)" should {
      "achieve p95 < 2s" in {
        val ds = staticDs(
          "bench-proj-10k",
          Seq("id" -> "integer", "value" -> "double", "category" -> "string"),
          syntheticRows(10_000)
        )
        val query = PanelQuery(
          selectedFields = List("id", "value"),
          filters        = Nil,
          sort           = None,
          limit          = None
        )

        // Explain plan
        val df = submitter.loadDataFrame(ds)
          .select("id", "value")
        println(s"\n=== [simple-projection] Query Plan ===")
        df.explain(extended = true)

        // Warm-up
        timeSamples(WARMUP_RUNS)(Await.result(executor.execute(ds, query), 30.seconds))

        // Timed samples
        val samples = timeSamples(TIMED_RUNS)(Await.result(executor.execute(ds, query), 30.seconds))
        val result  = p95(samples)
        println(s"[simple-projection] p95 = ${result}ms  (samples: ${samples.sorted.mkString(", ")})")

        result should be < TARGET_P95MS
      }
    }

    "scenario: filter + sort (10k rows)" should {
      "achieve p95 < 2s" in {
        val ds = staticDs(
          "bench-filter-sort-10k",
          Seq("id" -> "integer", "value" -> "double", "category" -> "string"),
          syntheticRows(10_000)
        )
        val query = PanelQuery(
          selectedFields = Nil,
          filters        = List(JsString("value > 500")),
          sort           = Some("value DESC"),
          limit          = None
        )

        // Explain plan
        val df = submitter.loadDataFrame(ds)
          .filter("value > 500")
          .sort(org.apache.spark.sql.functions.col("value").desc)
        println(s"\n=== [filter-sort] Query Plan ===")
        df.explain(extended = true)

        // Warm-up
        timeSamples(WARMUP_RUNS)(Await.result(executor.execute(ds, query), 30.seconds))

        // Timed samples
        val samples = timeSamples(TIMED_RUNS)(Await.result(executor.execute(ds, query), 30.seconds))
        val result  = p95(samples)
        println(s"[filter-sort] p95 = ${result}ms  (samples: ${samples.sorted.mkString(", ")})")

        result should be < TARGET_P95MS
      }
    }

    "scenario: aggregation group-by + sum (100k rows)" should {
      "achieve p95 < 2s" in {
        val ds = staticDs(
          "bench-agg-100k",
          Seq("id" -> "integer", "value" -> "double", "category" -> "string"),
          syntheticRows(100_000)
        )
        // Use a direct Spark query for aggregation since PanelQueryExecutor does not
        // natively support groupBy (that lives in PipelineStep). We benchmark the
        // DataFrame operation stack that PanelQueryExecutor would invoke.
        val baseQuery = PanelQuery(
          selectedFields = List("value", "category"),
          filters        = Nil,
          sort           = None,
          limit          = None
        )

        // Explain plan for the aggregation
        val df = submitter.loadDataFrame(ds)
          .select("value", "category")
          .groupBy("category")
          .sum("value")
        println(s"\n=== [aggregation] Query Plan ===")
        df.explain(extended = true)

        // Benchmark the groupBy+sum directly (not via executor — executor does projection+filter+sort+limit)
        def aggBench(): Unit = {
          val agg = submitter.loadDataFrame(ds)
            .select("value", "category")
            .groupBy("category")
            .sum("value")
          submitter.collectRows(agg)
          ()
        }

        // Warm-up
        (1 to WARMUP_RUNS).foreach(_ => aggBench())

        // Timed samples
        val samples = timeSamples(TIMED_RUNS)(aggBench())
        val result  = p95(samples)
        println(s"[aggregation] p95 = ${result}ms  (samples: ${samples.sorted.mkString(", ")})")

        result should be < TARGET_P95MS
      }
    }

    "scenario: paginated query (100k rows, page 0, pageSize 10)" should {
      "achieve p95 < 2s using PanelQueryExecutor.executePaginated" in {
        val ds = staticDs(
          "bench-paginated-100k",
          Seq("id" -> "integer", "value" -> "double", "category" -> "string"),
          syntheticRows(100_000)
        )
        val query = PanelQuery(
          selectedFields = Nil,
          filters        = List(JsString("value > 100")),
          sort           = Some("value ASC"),
          limit          = None
        )

        // Explain plan
        val df = submitter.loadDataFrame(ds)
          .filter("value > 100")
          .sort(org.apache.spark.sql.functions.col("value").asc)
        println(s"\n=== [paginated] Query Plan ===")
        df.explain(extended = true)

        // Warm-up
        (1 to WARMUP_RUNS).foreach { _ =>
          Await.result(executor.executePaginated(ds, query, page = 0, pageSize = 10), 30.seconds)
        }

        // Timed samples
        val samples = timeSamples(TIMED_RUNS) {
          Await.result(executor.executePaginated(ds, query, page = 0, pageSize = 10), 30.seconds)
        }
        val result = p95(samples)
        println(s"[paginated] p95 = ${result}ms  (samples: ${samples.sorted.mkString(", ")})")

        result should be < TARGET_P95MS
      }
    }
  }
}
