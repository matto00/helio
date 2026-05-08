package com.helio.spark

import com.helio.domain.{DataSource, PanelQuery, SourceType}
import org.apache.spark.sql.{functions => F}
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
        val df = submitter.loadDataFrame(dataSource)

        // 1. Projection (select)
        val projected =
          if (query.selectedFields.isEmpty) df
          else df.select(query.selectedFields.head, query.selectedFields.tail: _*)

        // 2. Filter pushdown — extract raw Spark SQL expression strings from JsString values
        val filtered = query.filters.foldLeft(projected) {
          case (acc, JsString(expr)) => acc.filter(expr)
          case (acc, _)              => acc // skip non-JsString items (forward-compatible)
        }

        // 3. Sort pushdown — parse "colName [ASC|DESC]" and apply via Column API
        val sorted = query.sort match {
          case Some(sortExpr) =>
            val tokens    = sortExpr.trim.split("\\s+", 2)
            val colName   = tokens(0)
            val descending = tokens.lift(1).exists(_.equalsIgnoreCase("DESC"))
            val sortCol   = if (descending) F.col(colName).desc else F.col(colName).asc
            filtered.sort(sortCol)
          case None => filtered
        }

        // 4. Limit pushdown
        val limited = query.limit match {
          case Some(n) => sorted.limit(n)
          case None    => sorted
        }

        submitter.collectRows(limited)
      }
    }(sparkEc)
}
