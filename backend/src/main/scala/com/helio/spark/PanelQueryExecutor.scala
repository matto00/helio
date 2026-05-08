package com.helio.spark

import com.helio.domain.{DataSource, PanelQuery}
import org.apache.spark.sql.{DataFrame, functions => F}
import spray.json.JsString

import java.util.concurrent.Executors
import scala.concurrent.{ExecutionContext, Future, blocking}

/**
 * Executes a [[PanelQuery]] against a [[DataSource]] using Spark.
 *
 * Delegates DataFrame loading and row collection to [[SparkJobSubmitter]]
 * (package-private access). Execution is synchronous but isolated on a
 * dedicated thread pool so the Pekko dispatcher is never blocked.
 */
class PanelQueryExecutor(submitter: SparkJobSubmitter) {

  private val sparkEc: ExecutionContext =
    ExecutionContext.fromExecutorService(Executors.newCachedThreadPool())

  /**
   * Load `dataSource` into Spark, apply pushdown operations in order
   * (select -> filter -> sort -> limit), and return result rows.
   *
   * Pushdown steps:
   *  - `selectedFields` — `DataFrame.select()` (column projection)
   *  - `filters`        — each `JsString` expression applied via `DataFrame.filter()`
   *  - `sort`           — `DataFrame.sort()` with ASC/DESC direction when set;
   *                       format is `"colName [ASC|DESC]"` (defaults to ASC)
   *  - `limit`          — `DataFrame.limit()` when set
   *
   * All operations are applied inside Spark before `collectRows()` is called;
   * no query predicates are applied in-memory after collection.
   *
   * @param dataSource A Spark-compatible data source (static or csv).
   * @param query      The panel query describing projection, filters, sort, and limit.
   * @return Future of result rows, each as a `Map[String, Any]`.
   */
  def execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]] =
    Future {
      blocking {
        // Build full pushdown plan (select → filter → sort → limit) then collect once.
        // No caching needed here — a single action on the plan.
        submitter.collectRows(buildPlan(dataSource, query))
      }
    }(sparkEc)

  /**
   * Execute a panel query with offset-based Spark pagination.
   *
   * The underlying DataFrame is `.cache()`d before the first action (count for
   * `hasMore` detection) and `.unpersist()`d after the second action (page slice
   * collection), eliminating redundant re-computation of the same query plan.
   *
   * @param dataSource A Spark-compatible data source.
   * @param query      The panel query with all pushdown predicates applied.
   * @param page       Zero-based page index.
   * @param pageSize   Number of rows per page (must be >= 1).
   * @return Future of `(rows, hasMore)` — rows for this page and a flag indicating
   *         whether further pages exist.
   */
  def executePaginated(
      dataSource: DataSource,
      query: PanelQuery,
      page: Int,
      pageSize: Int
  ): Future[(Seq[Map[String, Any]], Boolean)] =
    Future {
      blocking {
        val built = buildPlan(dataSource, query)

        // Cache before the first action so the plan is not re-computed for the slice.
        built.cache()
        try {
          val totalCount = built.count()
          val offset     = page.toLong * pageSize
          val hasMore    = offset + pageSize < totalCount

          val pageSlice =
            if (offset >= totalCount) Seq.empty[Map[String, Any]]
            else {
              // Collect up to (offset + pageSize) rows, then drop the leading offset rows in-memory.
              // The DF is already cached so this second action does not recompute the plan.
              val allUpToEnd = submitter.collectRows(built.limit((offset + pageSize).toInt))
              allUpToEnd.drop(offset.toInt)
            }

          (pageSlice, hasMore)
        } finally {
          built.unpersist()
        }
      }
    }(sparkEc)

  /** Build the pushdown DataFrame plan without triggering any Spark action. */
  private def buildPlan(dataSource: DataSource, query: PanelQuery): DataFrame = {
    val df = submitter.loadDataFrame(dataSource)

    val projected =
      if (query.selectedFields.isEmpty) df
      else df.select(query.selectedFields.head, query.selectedFields.tail: _*)

    val filtered = query.filters.foldLeft(projected) {
      case (acc, JsString(expr)) => acc.filter(expr)
      case (acc, _)              => acc
    }

    val sorted = query.sort match {
      case Some(sortExpr) =>
        val tokens     = sortExpr.trim.split("\\s+", 2)
        val colName    = tokens(0)
        val descending = tokens.lift(1).exists(_.equalsIgnoreCase("DESC"))
        val sortCol    = if (descending) F.col(colName).desc else F.col(colName).asc
        filtered.sort(sortCol)
      case None => filtered
    }

    query.limit match {
      case Some(n) => sorted.limit(n)
      case None    => sorted
    }
  }
}
