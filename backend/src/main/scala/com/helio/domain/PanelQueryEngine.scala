package com.helio.domain

import scala.concurrent.Future

/** Abstracts panel query execution so panels can run with or without Spark.
 * The Spark implementation lives in `com.helio.spark.PanelQueryExecutor`;
 * the default in-process implementation is [[InProcessPanelQueryEngine]].
 */
trait PanelQueryEngine {
  def execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]]
}
