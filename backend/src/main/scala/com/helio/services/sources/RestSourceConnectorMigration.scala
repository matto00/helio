package com.helio.services.sources

import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.domain.model.{ApiKeyPlacement, DataSourceId, QueryParams, RestApiAuth, RestApiConfig, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import org.apache.pekko.http.scaladsl.model.Uri
import org.slf4j.Logger
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** HEL-822 design.md Decision 7: idempotent startup pass that migrates every pre-existing
 *  `rest_api` data source from its inline `url`/`auth`/`headers` shape into the new
 *  `connectorId`-referencing shape, synthesizing a 1:1 Connector per source (no dedup —
 *  design.md Decision 1). Application code, not a Flyway SQL migration — encryption requires
 *  the JVM-side `EncryptedSecretBackend`/`MasterKeyProvider`, which a raw SQL migration cannot
 *  reach.
 *
 *  '''Reversibility (design.md Decision 8): this migration is NOT automatically reversible.'''
 *  No rollback tool is shipped. A Connector's credential CAN in principle be decrypted
 *  (`ConnectorCredentialRepository.decryptForUse`) and a legacy-shaped config reconstructed,
 *  but no automated "undo" exists — a bad deploy is better recovered via a pre-migration DB
 *  snapshot/backup than bespoke in-app rollback code that would itself need to be trusted not
 *  to further corrupt data on the way back.
 *
 *  Branches every `rest_api` row into exactly one of four outcomes (Decision 6/7), never
 *  conflated:
 *   1. Already migrated (`decodeRest` returns `Right`) -> skip, no-op.
 *   2. Legacy + owned (`Left("legacy-unmigrated")`, `owner_id` non-null) -> migrate.
 *   3. Legacy + ownerless (`owner_id IS NULL`, round-3 CR5) -> log at `error`, skip.
 *   4. Malformed (`Left("malformed: ...")`) -> log at `error`, skip.
 *
 *  Safe to run on every boot — an already-migrated row is a no-op (branch 1). */
object RestSourceConnectorMigration {

  private case class LegacyRestApiAuthPayload(
      `type`: String,
      token: Option[String],
      name: Option[String],
      value: Option[String],
      in: Option[String]
  )
  private case class LegacyRestApiConfigPayload(
      url: String,
      method: Option[String],
      auth: Option[LegacyRestApiAuthPayload],
      headers: Option[Map[String, String]]
  )
  private object LegacyFormats extends DefaultJsonProtocol {
    implicit val authFmt: RootJsonFormat[LegacyRestApiAuthPayload]   = jsonFormat5(LegacyRestApiAuthPayload)
    implicit val cfgFmt: RootJsonFormat[LegacyRestApiConfigPayload] = jsonFormat4(LegacyRestApiConfigPayload)
  }
  import LegacyFormats._

  private def toAuth(a: Option[LegacyRestApiAuthPayload]): RestApiAuth = a match {
    case None => RestApiAuth.NoAuth
    case Some(p) =>
      p.`type` match {
        case "bearer" => RestApiAuth.BearerAuth(p.token.getOrElse(""))
        case "api_key" =>
          val placement = if (p.in.contains("query")) ApiKeyPlacement.Query else ApiKeyPlacement.Header
          RestApiAuth.ApiKeyAuth(p.name.getOrElse(""), p.value.getOrElse(""), placement)
        case _ => RestApiAuth.NoAuth
      }
  }

  /** Splits a legacy full URL into `(baseUrl, endpoint, queryParams)` using Pekko's existing
   *  `Uri` parser (no new URL-parsing code) — round-tripped through
   *  `RestApiConnectorDriver.joinUrl` so `baseUrl + endpoint` reconstructs the original URL
   *  exactly. `baseUrl` = scheme + authority; `endpoint` = path (+ query captured separately
   *  as `queryParams`, not embedded in the endpoint string).
   *
   *  HEL-844: `queryParams` is now `QueryParams`, an ordered, duplicate-preserving sequence —
   *  every pair from the legacy URL survives, in order, including a repeated key
   *  (`?tag=a&tag=b`). The `hasDuplicateKeys`/warn-on-collapse escape hatch this method used to
   *  return is gone: there is no longer a collapse for it to describe. */
  private[sources] def splitUrl(rawUrl: String): (String, String, QueryParams) = {
    val uri        = Uri(rawUrl)
    val baseUrl    = s"${uri.scheme}://${uri.authority.toString}"
    val path       = uri.path.toString
    val queryPairs = uri.query()
    (baseUrl, path, QueryParams(queryPairs.toVector))
  }

  def run(
      dataSourceRepo: DataSourceRepository,
      connectorRepo: ConnectorRepository,
      @annotation.unused ctx: DbContext,
      logger: Logger
  )(implicit ec: ExecutionContext): Future[Unit] =
    dataSourceRepo.findAllRestApiRawInternal().flatMap { rows =>
      Future
        .sequence(rows.map { case (id, ownerIdOpt, name, rawConfig) => migrateOne(dataSourceRepo, connectorRepo, id, ownerIdOpt, name, rawConfig, logger) })
        .map(_ => ())
    }

  private def migrateOne(
      dataSourceRepo: DataSourceRepository,
      connectorRepo: ConnectorRepository,
      id: String,
      ownerIdOpt: Option[java.util.UUID],
      name: String,
      rawConfig: String,
      logger: Logger
  )(implicit ec: ExecutionContext): Future[Unit] =
    DataSourceConfigCodec.decodeRest(rawConfig) match {
      case Right(_) =>
        // Already migrated — no-op (idempotency).
        Future.successful(())
      case Left("legacy-unmigrated") =>
        ownerIdOpt match {
          case None =>
            // design.md Decision 7 revised (round-3 CR5): ownerless legacy row — no owner to
            // synthesize a Connector under. Skipped, never mis-owned to a default account.
            logger.error("RestSourceConnectorMigration: skipping ownerless legacy rest_api source id={}", id)
            Future.successful(())
          case Some(ownerUuid) =>
            val ownerId = UserId(ownerUuid.toString)
            Try(JsonParser(rawConfig).convertTo[LegacyRestApiConfigPayload]) match {
              case Failure(e) =>
                logger.error(s"RestSourceConnectorMigration: skipping malformed-legacy rest_api source id=$id", e)
                Future.successful(())
              case Success(legacy) =>
                val (baseUrl, endpoint, queryParams) = splitUrl(legacy.url)
                val auth = toAuth(legacy.auth)
                val (connName, configJson, credentialPlaintext, credentialName) =
                  ImplicitConnectorConfig.forLegacySource(s"Migrated: $name", baseUrl, auth)
                connectorRepo
                  .create(
                    ownerId             = ownerId,
                    name                = connName,
                    kind                = "rest_api",
                    baseUrl             = baseUrl,
                    config              = configJson,
                    credentialPlaintext = credentialPlaintext,
                    credentialName      = credentialName
                  )
                  .flatMap { connector =>
                    val newConfig = RestApiConfig(
                      connectorId = connector.id.value,
                      endpoint    = endpoint,
                      method      = legacy.method.getOrElse("GET"),
                      queryParams = queryParams,
                      headers     = legacy.headers.getOrElse(Map.empty)
                    )
                    dataSourceRepo.updateConfigInternal(DataSourceId(id), DataSourceConfigCodec.encodeRest(newConfig)).map(_ => ())
                  }
                  .recover { case e =>
                    logger.error(s"RestSourceConnectorMigration: failed to migrate rest_api source id=$id", e)
                  }
            }
        }
      case Left(malformed) =>
        logger.error("RestSourceConnectorMigration: skipping malformed rest_api source id={}: {}", id, malformed)
        Future.successful(())
    }
}
