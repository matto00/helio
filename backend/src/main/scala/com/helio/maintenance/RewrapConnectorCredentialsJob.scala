package com.helio.maintenance

import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.{Database, DbContext}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.typesafe.config.ConfigFactory
import org.slf4j.LoggerFactory

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** One-shot maintenance job for master-key rotation step 3 (design.md Decision 5, task 5.2). Not
 *  an HTTP route -- this ticket adds no client-facing surface for rotation. Run manually by an
 *  operator after redeploying with `CONNECTOR_MASTER_KEY`/`_ID` set to the new key and
 *  `CONNECTOR_MASTER_KEY_PREVIOUS`/`_ID` set to the old key (rotation step 2), before retiring the
 *  old Secret Manager secret version (rotation step 4):
 *
 *  {{{
 *    sbt "runMain com.helio.maintenance.RewrapConnectorCredentialsJob"
 *  }}}
 *
 *  Re-wraps every `connector_credentials` row whose `key_id` is not the currently-configured
 *  `CONNECTOR_MASTER_KEY_ID` -- see [[ConnectorCredentialRepository.rewrapAllBelow]] for the actual
 *  unwrap/wrap/update logic. Logs only counts and key ids, never plaintext or ciphertext bytes. */
object RewrapConnectorCredentialsJob {

  private val logger = LoggerFactory.getLogger(getClass)

  def main(args: Array[String]): Unit = {
    implicit val ec: ExecutionContext = ExecutionContext.global

    val config       = ConfigFactory.load()
    val appDb        = Database.initApp(config)
    val privilegedDb = Database.initPrivileged(config)
    val ctx          = new DbContext(appDb, privilegedDb)

    val provider = new EnvMasterKeyProvider()
    val backend  = new EncryptedSecretBackend(provider)
    val repo     = new ConnectorCredentialRepository(ctx, backend)

    val currentKeyId = sys.env
      .get(EnvMasterKeyProvider.CurrentKeyIdEnvVar)
      .map(_.trim)
      .filter(_.nonEmpty)
      .getOrElse {
        logger.error(
          s"${EnvMasterKeyProvider.CurrentKeyIdEnvVar} is not set -- refusing to run the re-wrap job"
        )
        sys.exit(1)
      }

    logger.info(s"Re-wrapping connector_credentials rows not already under key_id=$currentKeyId")
    val rewrapped = Await.result(repo.rewrapAllBelow(currentKeyId, provider), 10.minutes)
    logger.info(s"Re-wrapped $rewrapped row(s) to key_id=$currentKeyId")
  }
}
