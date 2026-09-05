package com.helio.domain.connectors

import com.helio.domain.engine.SchemaInferenceEngine
import com.helio.domain.model.{ApiKeyPlacement, Connector, ConnectorId, EphemeralRestConfig, InferredSchema, QueryParams, RestApiConfig}
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.sources.ContentSourceSupport
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.settings.ConnectionPoolSettings
import org.apache.pekko.stream.Materializer
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import scala.util.Try

/** Dependency-free companion object — see design.md Decision 1. `RestApiConnectorDriver` (the class)
 *  requires an `ActorSystem` to construct, so its `ConnectorMetadata` value lives here instead,
 *  reachable from `ConnectorRegistry`/`DataSourceKind.All`'s static call sites without
 *  constructing an instance. */
object RestApiConnectorDriver {
  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "rest_api",
    displayName = "REST API",
    supportsIncremental = false,
    authKind = "configurable",
    // HEL-822 design.md Decision 10: advertises the primary (new) required field.
    // The legacy bare-`url` alternative is dual-supported (design.md Decision 1) but not
    // also listed here — a "required fields" list describing two mutually-exclusive
    // alternatives would mislead a client trying to satisfy it.
    requiredFields = Vector(
      ConnectorFieldDescriptor(name = "connectorId", label = "Connector", secret = false)
    )
  )
}

class RestApiConnectorDriver(
    // Kept as the FIRST positional param (task 8.3) — matches the pre-HEL-822 single-param
    // constructor shape so every existing `new RestApiConnectorDriver(Some(fn))`
    // fetchOverride-based test construction keeps compiling unchanged.
    fetchOverride: Option[RestApiConfig => Future[Either[String, JsValue]]] = None,
    connectorRepoOpt: Option[ConnectorRepository] = None,
    credentialRepoOpt: Option[ConnectorCredentialRepository] = None,
    // HEL-879 design.md Decision 2/5: appended LAST so every existing
    // positional construction (~20 fetchOverride-based test fixtures) keeps
    // compiling unchanged. Real defaults are wired at the sole production
    // construction site, `Main.scala`; a test builds its own driver with an
    // `isBlocked` keyed on a known-safe hostname (never widening a class).
    resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
)(implicit system: ActorSystem[_])
    extends ConnectorDriver[RestApiConfig] {

  private val log = LoggerFactory.getLogger(getClass)

  override val metadata: ConnectorMetadata = RestApiConnectorDriver.metadata

  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer    = Materializer(system)

  /** Resolves `config.connectorId` per `resolveContext` (design.md Decision 11): `Owned`
   *  scopes to the caller (`findByIdOwned`), `Internal` bypasses ownership
   *  (`findByIdInternal`) — used only by the pipeline-execution path. A missing
   *  `connectorRepoOpt` (test fixtures that never wire one) or an unresolved id both
   *  produce the same curated `Left`, never a raw exception (task 2.3). */
  private def resolveConnector(connectorId: String, resolveContext: ConnectorResolveContext): Future[Either[String, Connector]] =
    connectorRepoOpt match {
      case None => Future.successful(Left("Connector not found"))
      case Some(repo) =>
        val found = resolveContext match {
          case ConnectorResolveContext.Owned(user) => repo.findByIdOwned(ConnectorId(connectorId), user)
          case ConnectorResolveContext.Internal     => repo.findByIdInternal(ConnectorId(connectorId))
        }
        found.map {
          case Some(c) => Right(c)
          // HEL-311: curated, never leaks the raw id or an internal message (task 2.3).
          case None    => Left("Connector not found")
        }
    }

  /** Joins `baseUrl` and `endpoint` without naive string concatenation — collapses a doubled
   *  `/` at the seam, inserts one if neither side has it (design.md Decision 3). The
   *  migration's own URL split (Decision 7) round-trips through this same join. */
  def joinUrl(baseUrl: String, endpoint: String): String = {
    if (endpoint.isEmpty) baseUrl
    else if (baseUrl.endsWith("/") && endpoint.startsWith("/")) baseUrl + endpoint.stripPrefix("/")
    else if (!baseUrl.endsWith("/") && !endpoint.startsWith("/")) baseUrl + "/" + endpoint
    else baseUrl + endpoint
  }

  /** Builds the full request for a Connector-resolved `RestApiConfig`: resolves `connectorId`
   *  → `Connector`, decrypts its credential, composes `baseUrl` + `endpoint` via `joinUrl` +
   *  `queryParams` + merged headers (source wins on collision, Decision 4), applies auth per
   *  the Connector's `ConnectorAuthShape`.
   *
   *  HEL-823: `endpoint`/`queryParams` values/`headers` values are resolved against
   *  `config.parameters` via `TemplateInterpolator` before being used — a `Left` (unresolved
   *  variable or a header failing the post-substitution CRLF guard) short-circuits BEFORE any
   *  `HttpRequest` is built, so no request is ever issued with an unresolved/hostile template.
   *  `credentialValue` (decrypted below) is deliberately never merged into the map passed to
   *  `TemplateInterpolator` (design.md Decision 4) — it is used only by
   *  `buildAuthHeaders`/`injectAuthQueryParam`, so it is structurally unreachable by name from
   *  a template, regardless of what a `parameters` key is named. */
  private def buildResolvedRequest(config: RestApiConfig, resolveContext: ConnectorResolveContext): Future[Either[String, HttpRequest]] =
    resolveConnector(config.connectorId, resolveContext).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(connector) =>
        val authShape = ConnectorAuthShape.parse(connector.config)
        val credentialFut = credentialRepoOpt match {
          case None => Future.successful(Right(""): Either[String, String])
          case Some(credRepo) =>
            credRepo.decryptForUse(connector.credentialId, connector.ownerId).map {
              case Some(plaintext) => Right(plaintext)
              case None            => Left("Connector credential not found")
            }
        }
        credentialFut.map {
          case Left(err) => Left(err)
          case Right(credentialValue) =>
            // HEL-826 design.md Decision 3 — the structural safety guards, checked FIRST,
            // before any templating/URI/entity work: a body on GET/HEAD, or an unparseable
            // bodyContentType, short-circuits before any HttpRequest is built.
            for {
              _            <- RestApiConfig.rejectBodyOnSafeMethod(config.method, config.body)
              parsedCt     <- RestApiConfig.parseBodyContentType(config.bodyContentType)
              resolvedBits <- resolveTemplatedRequestParts(config)
            } yield {
              val (resolvedEndpoint, resolvedQueryParams, resolvedHeaders, resolvedBody) = resolvedBits
              val method = HttpMethods.getForKey(config.method.toUpperCase).getOrElse(HttpMethods.GET)

              // HEL-844 design.md D4: a single ordered `Uri.Query` built from the endpoint's own
              // existing pairs followed by the config's pairs — preserves duplicate keys AND their
              // order. The previous per-param `uri.query().toMap` fold did NOT drop the endpoint's
              // query string outright (its distinct pairs survived); it silently REORDERED them
              // (`Map`'s hash-based iteration order, not insertion order) and COLLAPSED any
              // duplicate key within them to its last value — corrected here.
              val baseUri         = Uri(joinUrl(connector.baseUrl, resolvedEndpoint))
              val combinedPairs   = baseUri.query().toVector ++ resolvedQueryParams.pairs
              val withQueryParams = baseUri.withQuery(Uri.Query(combinedPairs: _*))
              val uri             = injectAuthQueryParam(withQueryParams, authShape, credentialValue)

              val mergedHeaders = authShape.defaultHeaders ++ resolvedHeaders // Decision 4: source wins
              val authHeaders: List[HttpHeader] = buildAuthHeaders(authShape, credentialValue)
              // Cycle-2 skeptic non-blocking note (a): a source/Connector-default header
              // colliding with the auth header's own name (e.g. "Authorization", or the
              // api-key header name) must not produce a request carrying both -- the auth
              // header (built from the decrypted credential, never client-suppliable) always
              // wins; HTTP header names are case-insensitive, so the collision check is too.
              val authHeaderNames = authHeaders.map(_.name().toLowerCase).toSet
              val baseHeaders: List[HttpHeader] = mergedHeaders
                .filterNot { case (k, _) => authHeaderNames.contains(k.toLowerCase) }
                .map { case (k, v) => RawHeader(k, v) }
                .toList

              val baseRequest = HttpRequest(method = method, uri = uri, headers = authHeaders ++ baseHeaders)
              resolvedBody.fold(baseRequest)(b => baseRequest.withEntity(HttpEntity(parsedCt, b.getBytes(StandardCharsets.UTF_8))))
            }
        }
    }

  /** HEL-823: resolves `{{name}}` placeholders in `config.endpoint`/`config.queryParams`
   *  values/`config.headers` values against `config.parameters`, applying per-context
   *  escaping (design.md Decision 3). Returns `Left(curatedError)` naming the first
   *  unresolved variable, or the first header failing the CRLF guard, before any HTTP
   *  request is constructed. */
  private def resolveTemplatedRequestParts(
      config: RestApiConfig
  ): Either[String, (String, QueryParams, Map[String, String], Option[String])] =
    for {
      endpoint <- TemplateInterpolator
        .resolveEndpoint(config.endpoint, config.parameters)
        .left
        .map(name => s"Unresolved template variable: $name")
      queryParams <- resolveQueryParams(config.queryParams, config.parameters)
      headers     <- resolveHeaderMapValues(config.headers, config.parameters)
      body <- config.body match {
        case None       => Right(None)
        case Some(tmpl) =>
          TemplateInterpolator
            .resolveJsonBody(tmpl, config.parameters)
            .left
            .map(name => s"Unresolved template variable: $name")
            .map(Some(_))
      }
    } yield (endpoint, queryParams, headers, body)

  /** Query param values: substituted raw (no extra encoding) — Pekko's `Uri.Query` already
   *  percent-encodes on render (design.md Decision 3). HEL-844 design.md D5: an ordered
   *  per-PAIR traversal (not per-unique-key), so `?tag={{a}}&tag={{b}}` resolves BOTH
   *  occurrences of a repeated key rather than collapsing them first. Keys are not templated
   *  (they were not before this change either). Failure semantics unchanged: the first
   *  unresolved variable short-circuits as a `Left` before any request is built. */
  private def resolveQueryParams(qp: QueryParams, params: Map[String, String]): Either[String, QueryParams] =
    qp.pairs.foldLeft[Either[String, Vector[(String, String)]]](Right(Vector.empty)) {
      case (acc, (k, v)) =>
        for {
          resolvedSoFar <- acc
          resolvedValue <- TemplateInterpolator.resolve(v, params).left.map(name => s"Unresolved template variable: $name")
        } yield resolvedSoFar :+ (k -> resolvedValue)
    }.map(QueryParams(_))

  /** Header values: substituted raw, then the whole resolved value is CRLF-guarded
   *  (design.md Decision 3) — a value containing `\r`/`\n` after substitution fails loud and
   *  is never sent. */
  private def resolveHeaderMapValues(map: Map[String, String], params: Map[String, String]): Either[String, Map[String, String]] =
    map.foldLeft[Either[String, Map[String, String]]](Right(Map.empty)) {
      case (acc, (k, v)) =>
        for {
          resolvedSoFar <- acc
          resolvedValue <- TemplateInterpolator.resolve(v, params).left.map(name => s"Unresolved template variable: $name")
          guardedValue  <- TemplateInterpolator.guardHeaderValue(resolvedValue)
        } yield resolvedSoFar + (k -> guardedValue)
    }

  private def buildAuthHeaders(authShape: ConnectorAuthShape, credentialValue: String): List[HttpHeader] =
    authShape.authType match {
      case "bearer"  => List(Authorization(OAuth2BearerToken(credentialValue)))
      case "api_key" if authShape.apiKeyPlacement.contains("header") =>
        List(RawHeader(authShape.apiKeyName.getOrElse(""), credentialValue))
      case _ => Nil
    }

  /** HEL-844 design.md D4a: the auth query parameter still wins a name collision — the
   *  query-side twin of the auth-header-always-wins rule above. Today's
   *  `uri.query().toMap + (name -> value)` gave that semantics as a side effect of `Map`
   *  overwrite; a naive ordered append would NOT — it would let a source configured with
   *  `?api_key=attacker` produce `api_key=attacker&api_key=<real credential>`, which many
   *  servers resolve to the FIRST occurrence (a credential-shadowing regression). So every
   *  existing pair whose name equals `apiKeyName` is dropped first, then the credential pair
   *  is appended. */
  private def injectAuthQueryParam(uri: Uri, authShape: ConnectorAuthShape, credentialValue: String): Uri =
    authShape.authType match {
      case "api_key" if authShape.apiKeyPlacement.contains("query") =>
        val apiKeyName  = authShape.apiKeyName.getOrElse("")
        val surviving   = uri.query().toVector.filterNot { case (k, _) => k == apiKeyName }
        uri.withQuery(Uri.Query((surviving :+ (apiKeyName -> credentialValue)): _*))
      case _ => uri
    }


  def fetch(config: RestApiConfig, resolveContext: ConnectorResolveContext): Future[Either[String, JsValue]] =
    fetchOverride.fold(doFetch(config, resolveContext))(fn => fn(config))

  /** HEL-826 design.md Decision 1 — `rootSelector = None` is byte-identical to pre-change
   *  behavior (the existing 3-way match, untouched). `Some(path)` walks `JsObject` fields
   *  only, dot-separated, then applies the SAME 3-way match to whatever is found at the end
   *  of the walk. A missing key or a non-object encountered mid-walk yields `Vector.empty`
   *  (curated-empty, not a 500) plus a server-side warn log — HEL-599 owns the real
   *  user-facing error envelope. */
  def toRows(json: JsValue, rootSelector: Option[String] = None): Vector[JsValue] =
    toRowsEither(json, rootSelector).getOrElse(Vector.empty)

  /** HEL-599 design.md D5: the curated-error counterpart of [[toRows]]. `rootSelector = None` is
   *  the byte-identical unset path — `toRows` is kept as a thin wrapper over this so that
   *  "unset selector is byte-identical to today" is verifiable against an unchanged function
   *  (task 4.3). `Left` fires ONLY when a selector was supplied and the walk failed (a missing
   *  segment, or descending through a non-object) — every other outcome, including a genuinely
   *  empty array, is `Right`; conflating "selector broken" with "selector matched nothing" would
   *  defeat the whole point of this criterion. The curated message names the selector and the
   *  failing segment only — no response body, no header, no credential (HEL-311 convention). */
  def toRowsEither(json: JsValue, rootSelector: Option[String] = None): Either[String, Vector[JsValue]] = {
    val target: Either[String, JsValue] = rootSelector match {
      case None       => Right(json)
      case Some(path) =>
        val segments = path.split("\\.").toVector
        segments.foldLeft[Either[String, JsValue]](Right(json)) {
          case (Right(obj: JsObject), segment) =>
            obj.fields.get(segment) match {
              case Some(next) => Right(next)
              case None =>
                log.warn(s"REST source rootSelector '$path' did not match the response shape; yielding zero rows")
                Left(s"rootSelector '$path' not found: no field '$segment'")
            }
          case (Right(_), segment) =>
            log.warn(s"REST source rootSelector '$path' did not match the response shape; yielding zero rows")
            Left(s"rootSelector '$path' not found: '$segment' is not an object")
          case (left @ Left(_), _) => left
        }
    }
    target.map {
      case JsArray(elements) => elements.toVector
      case obj: JsObject     => Vector(obj)
      case other             => Vector(other)
    }
  }

  private def doFetch(config: RestApiConfig, resolveContext: ConnectorResolveContext): Future[Either[String, JsValue]] =
    buildResolvedRequest(config, resolveContext).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(request) => issueAndParse(request)
    }

  /** HEL-879 design.md Decision 2: the SSRF guard sits HERE — the request-
   *  ISSUING choke point both `doFetch` (resolved-Connector path) and
   *  `fetchEphemeral` (bare-URL path) funnel through — keyed on
   *  `request.uri.toString`, the final, post-templating, post-`joinUrl` URI.
   *  A request not issued through `issueAndParse`/`issueTest` is not issued
   *  at all, so any future REST entry point is covered automatically. Runs
   *  BEFORE any connection is opened; on success, pins the actual TCP
   *  connection to the validated `InetAddress` (design.md Decision 1/HEL-215
   *  cycle-3 DNS-rebinding fix) instead of using the shared, unpinned
   *  `poolSettings`. */
  private def guardedPoolSettings(request: HttpRequest): Either[String, ConnectionPoolSettings] =
    ContentSourceSupport.validateAndResolve(request.uri.toString, resolveHost, isBlocked).map { pinnedAddress =>
      ContentSourceSupport.pinnedPoolSettings(pinnedAddress)
    }

  private def issueAndParse(request: HttpRequest): Future[Either[String, JsValue]] =
    guardedPoolSettings(request) match {
      case Left(err) => Future.successful(Left(err))
      case Right(settings) =>
        Http(system.classicSystem)
          .singleRequest(request, settings = settings)
          .flatMap { response =>
            response.entity.toStrict(30.seconds).map { entity =>
              val body = entity.data.utf8String
              // HEL-879 design.md Decision 3: explicit 2xx-range check, matching
              // ContentSourceSupport.fetchUrl's idiom -- `StatusCode.isSuccess()`
              // is `true` for 3xx too (`Redirection` extends the same
              // `HttpSuccess` marker as `Success`), which would otherwise parse
              // a redirect stub's body as though it were the real response.
              val code = response.status.intValue()
              if (code >= 200 && code < 300) {
                Try(body.parseJson).toEither.left.map { e =>
                  // HEL-311: keep the curated category prefix, drop the raw
                  // parser-exception tail; log the cause.
                  log.error("Failed to parse JSON response from REST source", e)
                  "Failed to parse JSON response"
                }
              } else {
                Left(s"HTTP $code: $body")
              }
            }
          }
          .recover { case e =>
            // HEL-311: keep the "Request failed" category prefix, drop the raw
            // exception tail; log the cause.
            log.error("REST source request failed", e)
            Left("Request failed")
          }
    }

  private def issueTest(request: HttpRequest): Future[Either[String, Unit]] =
    guardedPoolSettings(request) match {
      case Left(err) => Future.successful(Left(err))
      case Right(settings) =>
        Http(system.classicSystem)
          .singleRequest(request, settings = settings)
          .flatMap { response =>
            response.entity.toStrict(30.seconds).map { entity =>
              val code = response.status.intValue()
              if (code >= 200 && code < 300)
                Right(())
              else
                Left(s"HTTP $code: ${entity.data.utf8String}")
            }
          }
          .recover { case e =>
            log.error("REST source request failed", e)
            Left("Request failed")
          }
    }


  /** Issues the same request/auth/header pipeline as `fetch`, but only inspects the response
   *  status — never calls `parseJson` on the body, so a non-JSON 200 response still succeeds. */
  def testConnection(config: RestApiConfig, resolveContext: ConnectorResolveContext)(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    buildResolvedRequest(config, resolveContext).flatMap {
      case Left(err)       => Future.successful(Left(err))
      case Right(request)  => issueTest(request)
    }

  /** Forwards to the existing `fetch`/`toRows` methods, routing through the shared
   *  `SchemaInferenceEngine.inferSchemaFromRows` facade (HEL-473) instead of calling `fromJson`
   *  directly on the raw response. `toRows` case-matches the same three response shapes `fromJson`
   *  handles (JSON array, single object, non-object scalar), so this produces byte-for-byte
   *  identical output to the pre-change `fromJson(json)` call (design.md Decision 1). */
  /** HEL-861 (design D6): this fetch already materializes the full row vector before schema
   *  inference runs, so `observedRowCount = Some(rows.size)` is free -- populated here, not in
   *  `SchemaInferenceEngine.inferSchemaFromRows` itself, which has no notion of a "total" (it
   *  only ever sees whatever rows it's handed). */
  def inferSchema(config: RestApiConfig, resolveContext: ConnectorResolveContext)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    fetch(config, resolveContext).map(_.flatMap(json => toRowsEither(json, config.rootSelector))
      .map(rows => SchemaInferenceEngine.inferSchemaFromRows(rows).copy(observedRowCount = Some(rows.size.toLong))))

  /** Forwards to the existing `fetch`/`toRowsEither` methods, truncating to `maxRows` — matching
   *  `SourceService.previewRest`'s `connector.toRows(json).take(10)` pattern. A `Left` from a
   *  broken `rootSelector` (design D5) propagates as-is so `InProcessPipelineEngine.loadRows`
   *  fails the run loudly instead of materialising zero rows.
   *
   *  HEL-861 design D2: the full row vector is already materialized here before `.take(maxRows)`,
   *  so the pre-`take` size is the true available count, free. `truncated` is strictly `all.size >
   *  maxRows` — a source of exactly `maxRows` rows is NOT truncated. */
  def fetch(config: RestApiConfig, maxRows: Int, resolveContext: ConnectorResolveContext)(implicit ec: ExecutionContext): Future[Either[String, FetchOutcome]] =
    fetch(config, resolveContext).map(_.flatMap(json => toRowsEither(json, config.rootSelector)).map { all =>
      FetchOutcome(all.take(maxRows), truncated = all.size > maxRows, availableRowCount = Some(all.size.toLong))
    })

  // Never resolves/persists a Connector — no auth, no normalizing join (no `baseUrl` to join
  // against). Used only by `POST /api/sources/infer|test` and inline pipeline-proposal sources
  // when the request carries a bare `url` instead of a `connectorId`.

  /** HEL-823 design.md Non-Goals: deliberately does NOT call `TemplateInterpolator` — the
   *  ephemeral path has no `RestSource`/`parameters` store to resolve against. A `{{...}}`
   *  placeholder in `config.url`/`config.headers` reaching this method is left as literal
   *  text, unchanged (existing, backward-compatible behavior; task 3.2/4.9). */
  /** HEL-826 design.md Decision 3/4 — the identical structural safety guards as
   *  `buildResolvedRequest` (`rejectBodyOnSafeMethod` + `parseBodyContentType`), applied
   *  first, before any request is built. No templating call (Decision 4 — the ephemeral path
   *  has no `parameters` store). */
  private def buildEphemeralRequest(config: EphemeralRestConfig): Either[String, HttpRequest] =
    for {
      _        <- RestApiConfig.rejectBodyOnSafeMethod(config.method, config.body)
      parsedCt <- RestApiConfig.parseBodyContentType(config.bodyContentType)
    } yield {
      val method  = HttpMethods.getForKey(config.method.toUpperCase).getOrElse(HttpMethods.GET)
      val headers: List[HttpHeader] = config.headers.map { case (k, v) => RawHeader(k, v) }.toList
      val baseRequest = HttpRequest(method = method, uri = Uri(config.url), headers = headers)
      config.body.fold(baseRequest)(b => baseRequest.withEntity(HttpEntity(parsedCt, b.getBytes(StandardCharsets.UTF_8))))
    }

  /** `fetchOverride` (test-only hook) is reused for the ephemeral path too — adapted through a
   *  synthetic `RestApiConfig` carrying the ephemeral request's `url`/`method`/`headers` in its
   *  `endpoint`/`method`/`headers` fields — so a single test fixture stubs both the
   *  Connector-resolving and ephemeral paths uniformly, rather than needing a second override
   *  hook. Never persisted/decoded; `connectorId` here is a fixed sentinel-shaped placeholder
   *  with no meaning beyond "this call came from the ephemeral path in a test fixture". */
  def fetchEphemeral(config: EphemeralRestConfig): Future[Either[String, JsValue]] =
    fetchOverride match {
      case Some(fn) =>
        RestApiConfig.rejectBodyOnSafeMethod(config.method, config.body) match {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            fn(
              RestApiConfig(
                connectorId     = "__ephemeral__",
                endpoint        = config.url,
                method          = config.method,
                headers         = config.headers,
                body            = config.body,
                bodyContentType = config.bodyContentType
              )
            )
        }
      case None =>
        buildEphemeralRequest(config) match {
          case Left(err)      => Future.successful(Left(err))
          case Right(request) => issueAndParse(request)
        }
    }

  def testConnectionEphemeral(config: EphemeralRestConfig): Future[Either[String, Unit]] =
    buildEphemeralRequest(config) match {
      case Left(err)      => Future.successful(Left(err))
      case Right(request) => issueTest(request)
    }

  def inferSchemaEphemeral(config: EphemeralRestConfig): Future[Either[String, InferredSchema]] =
    fetchEphemeral(config).map(_.flatMap(json => toRowsEither(json, config.rootSelector))
      .map(rows => SchemaInferenceEngine.inferSchemaFromRows(rows)))
}
