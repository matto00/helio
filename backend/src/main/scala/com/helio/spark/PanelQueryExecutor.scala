package com.helio.spark

import com.helio.domain.{DataSource, PanelQuery, SourceType}

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
   * Load `dataSource` into Spark, project the columns listed in `query.selectedFields`
   * (or all columns when `selectedFields` is empty), and return result rows.
   *
   * @param dataSource A Spark-compatible data source (static or csv).
   * @param query      The panel query; only `selectedFields` is applied.
   * @return Future of result rows, each as a `Map[String, Any]`.
   */
  def execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]] =
    Future {
      blocking {
        val df = submitter.loadDataFrame(dataSource)

        val projected =
          if (query.selectedFields.isEmpty) df
          else df.select(query.selectedFields.head, query.selectedFields.tail: _*)

        submitter.collectRows(projected)
      }
    }(sparkEc)
}
