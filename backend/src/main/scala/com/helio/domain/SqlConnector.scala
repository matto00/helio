package com.helio.domain

import spray.json._

import java.sql.{Connection, DriverManager, Types}
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.util.Try

object SqlConnector {

  // ── DDL/DML keyword check ─────────────────────────────────────────────────

  private val ddlDmlPattern =
    """(?i)\b(CREATE|DROP|ALTER|DELETE|INSERT|UPDATE|TRUNCATE)\b""".r

  /** Returns Left with an error message if the query contains DDL/DML keywords,
   *  Right(()) otherwise. */
  def checkQuery(query: String): Either[String, Unit] =
    if (ddlDmlPattern.findFirstIn(query).isDefined)
      Left("Query contains DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE) which are not permitted")
    else
      Right(())

  // ── JDBC URL construction ─────────────────────────────────────────────────

  def buildJdbcUrl(config: SqlSourceConfig): String = config.dialect match {
    case "postgresql" =>
      s"jdbc:postgresql://${config.host}:${config.port}/${config.database}"
    case "mysql" =>
      s"jdbc:mysql://${config.host}:${config.port}/${config.database}?useSSL=false&allowPublicKeyRetrieval=true"
    case other =>
      s"jdbc:${other}://${config.host}:${config.port}/${config.database}"
  }

  /** Opens a JDBC connection for the given config. Throws on failure. */
  def connect(config: SqlSourceConfig): Connection = {
    val url = buildJdbcUrl(config)
    DriverManager.getConnection(url, config.user, config.password)
  }

  // ── Query execution ───────────────────────────────────────────────────────

  /** Executes the query and returns rows as a sequence of column-name → JsValue maps.
   *  Uses `scala.concurrent.blocking` to avoid starving the Akka dispatcher.
   *  Query timeout is set to 30 seconds; row count is capped at `maxRows`. */
  def execute(config: SqlSourceConfig, maxRows: Int)(implicit ec: ExecutionContext)
      : Future[Either[String, Seq[Map[String, JsValue]]]] =
    Future {
      blocking {
        Try {
          val conn = connect(config)
          try {
            val stmt = conn.prepareStatement(config.query)
            stmt.setQueryTimeout(30)
            stmt.setMaxRows(maxRows)
            val rs   = stmt.executeQuery()
            val meta = rs.getMetaData
            val colCount = meta.getColumnCount

            val rows = scala.collection.mutable.ArrayBuffer.empty[Map[String, JsValue]]
            while (rs.next()) {
              val row = (1 to colCount).map { i =>
                val colName = meta.getColumnLabel(i)
                val jsVal: JsValue = meta.getColumnType(i) match {
                  case Types.INTEGER | Types.BIGINT | Types.SMALLINT | Types.TINYINT =>
                    val v = rs.getLong(i)
                    if (rs.wasNull()) JsNull else JsNumber(v)
                  case Types.FLOAT | Types.DOUBLE | Types.REAL | Types.DECIMAL | Types.NUMERIC =>
                    val v = rs.getDouble(i)
                    if (rs.wasNull()) JsNull else JsNumber(BigDecimal(v))
                  case Types.BOOLEAN | Types.BIT =>
                    val v = rs.getBoolean(i)
                    if (rs.wasNull()) JsNull else JsBoolean(v)
                  case _ =>
                    val v = rs.getString(i)
                    if (rs.wasNull()) JsNull else JsString(v)
                }
                colName -> jsVal
              }.toMap
              rows += row
            }
            rs.close()
            stmt.close()
            rows.toSeq
          } finally {
            conn.close()
          }
        }.toEither.left.map(e => s"SQL execution failed: ${e.getMessage}")
      }
    }

  // ── Schema inference ──────────────────────────────────────────────────────

  /** Converts rows to a JsArray and runs schema inference via SchemaInferenceEngine. */
  def inferSchema(rows: Seq[Map[String, JsValue]]): InferredSchema = {
    val jsArray = JsArray(rows.map(row => JsObject(row)).toVector)
    SchemaInferenceEngine.fromJson(jsArray)
  }

  /** Converts rows to a JsArray (used for preview responses). */
  def toRows(rows: Seq[Map[String, JsValue]]): Vector[JsValue] =
    rows.map(row => JsObject(row)).toVector
}
