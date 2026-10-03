package com.helio.domain.connectors

import com.helio.domain.engine.SchemaInferenceEngine
import com.helio.domain.model.{InferredSchema, SqlSourceConfig}
import com.helio.services.sources.{ContentSourceSupport, EgressCheck}
import org.slf4j.LoggerFactory
import spray.json._

import java.net.InetAddress
import java.sql.{Connection, DriverManager, Types}
import java.util.Properties
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.util.Try

/** HEL-952: thrown by [[SqlConnectorDriver.connect]] when [[SqlConnectorDriver.checkConfigEgress]]
 *  refuses the config's host — a typed refusal (not a bare `RuntimeException`) so the task-7
 *  mutation check can assert the test fails for the RIGHT reason (this exception, not a timeout /
 *  missing driver / fixture error), and so a later ticket (HEL-953) has a typed thing to map to a
 *  4xx. `execute`/`testConnection`'s `.toEither.left.map` handlers special-case this one exception
 *  type to surface its (non-sensitive — hostname/address-class only, never a credential) refusal
 *  message verbatim rather than the generic "SQL execution failed"/"SQL connection failed"
 *  category message every OTHER connection failure still gets — this is what lets a caller (and
 *  the task-7 mutation check) tell "the guard refused this" apart from "the driver/network
 *  failed" without message-substring-matching a raw JDBC exception. */
final case class SqlEgressRefusedException(refusalMessage: String) extends RuntimeException(refusalMessage)

/** HEL-998: a SQL config this connector will not open a connection for (unsupported dialect, or a
 *  database name that could smuggle a JDBC URL parameter). Typed, like [[SqlEgressRefusedException]],
 *  so `execute`/`testConnection` surface its non-sensitive message verbatim. */
final case class SqlConfigRefusedException(refusalMessage: String) extends RuntimeException(refusalMessage)

object SqlConnectorDriver extends ConnectorDriver[SqlSourceConfig] {

  private val log = LoggerFactory.getLogger(getClass)

  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "sql",
    displayName = "SQL Database",
    supportsIncremental = false,
    authKind = "basic",
    // Matches SqlSourceConfigPayload's fields (DataSourceProtocol.scala) — all
    // seven are required on that payload; `password` is the one secret field.
    requiredFields = Vector(
      ConnectorFieldDescriptor(name = "dialect", label = "Dialect", secret = false),
      ConnectorFieldDescriptor(name = "host", label = "Host", secret = false),
      ConnectorFieldDescriptor(name = "port", label = "Port", secret = false),
      ConnectorFieldDescriptor(name = "database", label = "Database", secret = false),
      ConnectorFieldDescriptor(name = "user", label = "User", secret = false),
      ConnectorFieldDescriptor(name = "password", label = "Password", secret = true),
      ConnectorFieldDescriptor(name = "query", label = "Query", secret = false)
    )
  )


  private val ddlDmlPattern =
    """(?i)\b(CREATE|DROP|ALTER|DELETE|INSERT|UPDATE|TRUNCATE)\b""".r

  /** Returns Left with an error message if the query contains DDL/DML keywords,
   *  Right(()) otherwise. */
  def checkQuery(query: String): Either[String, Unit] =
    if (ddlDmlPattern.findFirstIn(query).isDefined)
      Left("Query contains DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE) which are not permitted")
    else
      Right(())


  val supportedDialects: Vector[String] = Vector("postgresql", "mysql")

  /** `matches` is a whole-string match, so a trailing newline or any `?&;/#%=` / whitespace fails. */
  private val databasePattern = "[A-Za-z0-9_.$-]+"

  /** HEL-998: the single shape validator every path that accepts a SQL config calls (create,
   *  infer, test-connection, inline pipeline sources) and `connect` re-applies. The dialect must
   *  be one with a connect-time socket-factory hook, and the database name is interpolated into
   *  the JDBC URL where query parameters outrank Properties, so it must not be able to carry
   *  `?socketFactory=...`. */
  def validateConfigShape(config: SqlSourceConfig): Either[String, Unit] =
    if (!supportedDialects.contains(config.dialect))
      Left(s"Unsupported SQL dialect '${config.dialect}': supported dialects are ${supportedDialects.mkString(", ")}")
    else if (!config.database.matches(databasePattern))
      Left("Invalid database name: only letters, digits, '_', '.', '$' and '-' are allowed")
    else Right(())

  def buildJdbcUrl(config: SqlSourceConfig): String = config.dialect match {
    case "postgresql" =>
      s"jdbc:postgresql://${config.host}:${config.port}/${config.database}"
    case "mysql" =>
      s"jdbc:mysql://${config.host}:${config.port}/${config.database}?useSSL=false&allowPublicKeyRetrieval=true"
    case other =>
      throw SqlConfigRefusedException(s"Unsupported SQL dialect '$other': supported dialects are ${supportedDialects.mkString(", ")}")
  }

  /** Driver Properties (never URL text) attaching the connect-time hook. `loginTimeout=0` pins
   *  pgjdbc to connect on the calling thread: a non-zero value moves the connect onto a driver
   *  thread where the [[EgressConnectGuard]] thread-local is unset and the production denylist
   *  would apply instead of an injected one. */
  private[connectors] def connectionProperties(config: SqlSourceConfig): Properties = {
    val props = new Properties()
    props.setProperty("user", config.user)
    props.setProperty("password", config.password)
    config.dialect match {
      case "postgresql" =>
        props.setProperty("socketFactory", classOf[PgEgressSocketFactory].getName)
        props.setProperty("loginTimeout", "0")
      case _ =>
        props.setProperty("socketFactory", classOf[MysqlEgressSocketFactory].getName)
    }
    props
  }

  /** HEL-952 design.md Decision 1/2: validates `config.host` — the EXACT string [[buildJdbcUrl]]
   *  interpolates into the JDBC URL — via the shared `ContentSourceSupport.checkEgressHost` policy
   *  core (no policy duplicated). `failOnUnresolvable` distinguishes the two dispositions design.md
   *  Decisions 2/3 require for the SAME "does not resolve right now" outcome: connect time
   *  (Decision 2, the security boundary) fails closed on it — an unresolvable host can never be
   *  connected to, so there is nothing to preserve; create time (Decision 3) tolerates it — a
   *  source naming a not-yet-provisioned host, or hitting a transient DNS blip, must still be
   *  creatable, and the connect-time check re-validates on every actual use anyway so nothing
   *  escapes. `Disallowed`/`Invalid` are ALWAYS fatal, at either time. */
  def checkConfigEgress(
      config: SqlSourceConfig,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr),
      failOnUnresolvable: Boolean = true
  ): Either[String, Unit] =
    ContentSourceSupport.checkEgressHost(config.host, resolveHost, isBlocked) match {
      case EgressCheck.Allowed(_)                            => Right(())
      case EgressCheck.Unresolvable(_) if !failOnUnresolvable => Right(())
      case EgressCheck.Unresolvable(msg)                     => Left(s"Egress refused: $msg")
      case EgressCheck.Invalid(msg)                          => Left(s"Egress refused: $msg")
      case EgressCheck.Disallowed(msg)                       => Left(s"Egress refused: $msg")
    }

  /** Opens a JDBC connection for the given config. Throws [[SqlConfigRefusedException]] for a
   *  config [[validateConfigShape]] refuses, [[SqlEgressRefusedException]] if `checkConfigEgress`
   *  refuses the host (HEL-952 design.md Decision 2 — every SQL operation reaches this one
   *  chokepoint) or the driver's own connect-time hook refuses the address it is about to connect
   *  to, or a driver exception on any other connection failure.
   *
   *  HEL-998: `checkConfigEgress` resolves the host once for a clear refusal message; the driver
   *  then resolves it again. That second lookup is authoritative: the driver's socket factory
   *  validates the `InetAddress` it actually connects to, so a DNS rebind between the two lookups
   *  cannot reach an internal address. `connectIsBlocked` defaults to the same `isBlocked` seam
   *  (keyed by `config.host`) so production uses the real denylist and tests that admit a known
   *  host through the guard admit it at connect too; pass it explicitly to make only the
   *  connect-time hook stricter or looser than the guard. */
  def connect(
      config: SqlSourceConfig,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr),
      connectIsBlocked: Option[InetAddress => Boolean] = None
  ): Connection = {
    validateConfigShape(config).left.foreach(msg => throw SqlConfigRefusedException(msg))
    checkConfigEgress(config, resolveHost, isBlocked, failOnUnresolvable = true) match {
      case Left(msg) => throw SqlEgressRefusedException(msg)
      case Right(()) =>
        val predicate = connectIsBlocked.getOrElse((addr: InetAddress) => isBlocked(config.host, addr))
        try EgressConnectGuard.withPredicate(predicate)(DriverManager.getConnection(buildJdbcUrl(config), connectionProperties(config)))
        catch {
          case e: Exception =>
            refusalInCauseChain(e).foreach(r => throw r)
            throw e
        }
    }
  }

  private def refusalInCauseChain(e: Throwable): Option[SqlEgressRefusedException] =
    Iterator.iterate(e)(_.getCause).takeWhile(_ != null).take(20).collectFirst { case r: SqlEgressRefusedException => r }

  /** Executes the query and returns rows as a sequence of column-name → JsValue maps.
   *  Uses `scala.concurrent.blocking` to avoid starving the Pekko dispatcher.
   *  Query timeout is set to 30 seconds; row count is capped at `maxRows`. */
  def execute(
      config: SqlSourceConfig,
      maxRows: Int,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
  )(implicit ec: ExecutionContext)
      : Future[Either[String, Seq[Map[String, JsValue]]]] =
    Future {
      blocking {
        Try {
          val conn = connect(config, resolveHost, isBlocked)
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
        }.toEither.left.map {
          // HEL-952 task 3.1: surface the guard's own refusal message verbatim (non-sensitive —
          // hostname/address-class only) rather than the generic category message, so a caller
          // can tell "the guard refused this" apart from any other connection failure.
          case SqlEgressRefusedException(msg) =>
            log.warn(s"SQL execution refused by egress guard: $msg")
            msg
          case SqlConfigRefusedException(msg) =>
            log.warn(s"SQL execution refused: $msg")
            msg
          case e =>
            // HEL-311: keep the "SQL execution failed" category prefix (not
            // sensitive), drop the raw JDBC/driver message tail, log the cause.
            log.error("SQL execution failed", e)
            "SQL execution failed"
        }
      }
    }


  /** Converts rows to the shared row shape and runs schema inference via the
   *  `SchemaInferenceEngine.inferSchemaFromRows` facade (HEL-473). */
  def inferSchema(rows: Seq[Map[String, JsValue]]): InferredSchema =
    SchemaInferenceEngine.inferSchemaFromRows(toRows(rows))

  /** Converts rows to a JsArray (used for preview responses). */
  def toRows(rows: Seq[Map[String, JsValue]]): Vector[JsValue] =
    rows.map(row => JsObject(row)).toVector


  /** Opens and immediately closes a JDBC connection — no query is executed.
   *  Uses `scala.concurrent.blocking` on the caller-supplied `ec`, matching `execute`. */
  def testConnection(
      config: SqlSourceConfig,
      resolveContext: ConnectorResolveContext,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
  )(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    Future {
      blocking {
        Try {
          connect(config, resolveHost, isBlocked).close()
        }.toEither.left.map {
          case SqlEgressRefusedException(msg) =>
            log.warn(s"SQL connection refused by egress guard: $msg")
            msg
          case SqlConfigRefusedException(msg) =>
            log.warn(s"SQL connection refused: $msg")
            msg
          case e =>
            // Distinct category prefix from `execute`'s "SQL execution failed" so
            // log/test consumers can't confuse a connection failure with a query failure.
            log.error("SQL connection failed", e)
            "SQL connection failed"
        }
      }
    }

  /** Forwards to the existing `execute`/`inferSchema(rows)` methods on the caller-supplied `ec`,
   *  matching `SourceService.inferSql`'s existing `maxRows = 100` sample size. */
  def inferSchema(
      config: SqlSourceConfig,
      resolveContext: ConnectorResolveContext,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
  )(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    execute(config, maxRows = 100, resolveHost, isBlocked).map(_.map(rows => inferSchema(rows)))

  /** HEL-861 design D3: probes with `maxRows + 1` — the JDBC cap (`execute`'s `setMaxRows`) never
   *  lets rows beyond the cap arrive, so the true total is unknowable without a second `COUNT(*)`
   *  query. If the `(maxRows + 1)`-th row arrives, more rows provably exist; if it does not, the
   *  result is provably complete. `execute` itself is unchanged — this `+ 1` lives only here, so
   *  `inferSchema` (100) and `previewSql` (10) keep their current behaviour. `availableRowCount`
   *  stays `None`: proving truncation this way does not reveal the true total. */
  def fetch(
      config: SqlSourceConfig,
      maxRows: Int,
      resolveContext: ConnectorResolveContext,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
  )(implicit ec: ExecutionContext)
      : Future[Either[String, FetchOutcome]] =
    execute(config, maxRows + 1, resolveHost, isBlocked).map(_.map { rows =>
      val all = toRows(rows)
      FetchOutcome(all.take(maxRows), truncated = all.size > maxRows, availableRowCount = None)
    })
}
