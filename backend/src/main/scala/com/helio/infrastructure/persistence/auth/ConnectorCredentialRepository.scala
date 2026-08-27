package com.helio.infrastructure.persistence.auth

import com.helio.domain.model.{ConnectorCredentialId, ConnectorCredentialMeta, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.auth.{EncryptedPayload, EncryptedSecretBackend, MasterKeyError, MasterKeyProvider, WrappedKey}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for envelope-encrypted third-party connector credentials (HEL-536). Mirrors
 *  `ApiTokenRepository`'s shape: every method runs under [[DbContext.withUserContext]] so the V92
 *  owner-only RLS policy scopes every read/write to the caller's own rows -- there is no
 *  privileged/system-context path here, unlike `ApiTokenRepository`'s pre-auth lookups, because
 *  every caller of this repository already has an authenticated user in hand.
 *
 *  `create` calls [[EncryptedSecretBackend.encrypt]] BEFORE touching the database -- on `Left`
 *  (e.g. no master key configured), no row is persisted at all; the failure propagates as a
 *  failed `Future`, never a partially-written or plaintext row (design.md Decision 3). */
class ConnectorCredentialRepository(ctx: DbContext, secretBackend: EncryptedSecretBackend)(implicit
    ec: ExecutionContext
) {

  import ConnectorCredentialRepository._

  private val credentials = TableQuery[ConnectorCredentialTable]

  /** Encrypts `plaintext` and persists it for `userId`. Fails (no row persisted) when
   *  `EncryptedSecretBackend.encrypt` returns `Left` -- most notably
   *  `MasterKeyError.NoKeyConfigured`, the single most important negative case in this ticket. */
  def create(userId: UserId, name: String, plaintext: String): Future[ConnectorCredentialMeta] =
    secretBackend.encrypt(plaintext) match {
      case Left(err) => Future.failed(ConnectorCredentialEncryptionFailed(err))
      case Right(payload) =>
        val id  = UUID.randomUUID()
        val now = Instant.now()
        val row = ConnectorCredentialRow(
          id             = id,
          userId         = UUID.fromString(userId.value),
          name           = name,
          keyId          = payload.keyId,
          wrappedDataKey = payload.wrappedDataKey,
          nonceDek       = payload.nonceDek,
          ciphertext     = payload.ciphertext,
          nonceValue     = payload.nonceValue,
          createdAt      = now,
          updatedAt      = now
        )
        ctx.withUserContext(userId.value)(credentials += row).map(_ => rowToMeta(row))
    }

  /** Metadata only -- id/name/key_id/timestamps, never plaintext or ciphertext. This is the only
   *  method any route-facing code should call; see [[ConnectorCredentialMeta]]'s own doc for why
   *  its shape structurally cannot carry a decrypted value. */
  def get(id: ConnectorCredentialId, userId: UserId): Future[Option[ConnectorCredentialMeta]] =
    ctx.withUserContext(userId.value)(
      credentials.filter(_.id === UUID.fromString(id.value)).result.headOption
    ).map(_.map(rowToMeta))

  /** All credentials owned by the caller, metadata only. */
  def list(userId: UserId): Future[Seq[ConnectorCredentialMeta]] =
    ctx.withUserContext(userId.value)(
      credentials.sortBy(_.createdAt.desc).result
    ).map(_.map(rowToMeta))

  /** The ONLY path that ever returns a decrypted plaintext value. Distinctly named so it cannot be
   *  confused with [[get]]/[[list]] -- intended to be called solely from the server-side connector-
   *  call code path, never from a route handler that serializes its result to JSON. Fails
   *  (`Left`-propagated as a failed `Future`) on a wrong/rotated/unresolvable master key, never
   *  returning corrupted or partial plaintext. */
  def decryptForUse(id: ConnectorCredentialId, userId: UserId): Future[Option[String]] =
    ctx.withUserContext(userId.value)(
      credentials.filter(_.id === UUID.fromString(id.value)).result.headOption
    ).map {
      case None => None
      case Some(row) =>
        secretBackend.decrypt(toPayload(row)) match {
          case Left(err)        => throw ConnectorCredentialDecryptionFailed(err)
          case Right(plaintext) => Some(plaintext)
        }
    }

  def delete(id: ConnectorCredentialId, userId: UserId): Future[Boolean] =
    ctx.withUserContext(userId.value)(
      credentials.filter(_.id === UUID.fromString(id.value)).delete
    ).map(_ > 0)

  /** Rotation support (design.md Decision 5 / task 5.2): re-wraps every row whose `key_id` is not
   *  `currentKeyId` under the currently-active master key, via `provider.unwrapDataKey` (resolves
   *  the row's old `key_id`, expected to be reachable only through `CONNECTOR_MASTER_KEY_PREVIOUS`/
   *  `_ID` during a rotation window) followed by `provider.wrapDataKey` (wraps under the new
   *  current key). Only the wrapping layer changes -- `ciphertext`/`nonce_value` (wrapped by the
   *  per-row data key, not the master key) are left untouched, which is the entire point of
   *  envelope encryption. Runs on the privileged pool: rotation is an operator-run maintenance
   *  task spanning every user's rows, not a request-bound per-owner action.
   *
   *  Returns the count of rows re-wrapped. Intended to be invoked from
   *  [[com.helio.maintenance.RewrapConnectorCredentialsJob]], never from an HTTP route. */
  def rewrapAllBelow(currentKeyId: String, provider: MasterKeyProvider): Future[Int] = {
    val staleRows = ctx.withSystemContext(
      credentials.filter(_.keyId =!= currentKeyId).result
    )
    staleRows.flatMap { rows =>
      val updates = rows.map { row =>
        val wrapped = WrappedKey(row.keyId, row.wrappedDataKey, row.nonceDek)
        provider.unwrapDataKey(wrapped) match {
          case Left(err) => Future.failed(ConnectorCredentialDecryptionFailed(err))
          case Right(dataKey) =>
            provider.wrapDataKey(dataKey) match {
              case Left(err) => Future.failed(ConnectorCredentialEncryptionFailed(err))
              case Right(rewrapped) =>
                ctx.withSystemContext(
                  credentials
                    .filter(_.id === row.id)
                    .map(t => (t.keyId, t.wrappedDataKey, t.nonceDek, t.updatedAt))
                    .update((rewrapped.keyId, rewrapped.ciphertext, rewrapped.nonce, Instant.now()))
                )
            }
        }
      }
      Future.sequence(updates).map(_.size)
    }
  }

  private def rowToMeta(row: ConnectorCredentialRow): ConnectorCredentialMeta =
    ConnectorCredentialMeta(
      id        = ConnectorCredentialId(row.id.toString),
      userId    = UserId(row.userId.toString),
      name      = row.name,
      keyId     = row.keyId,
      createdAt = row.createdAt,
      updatedAt = row.updatedAt
    )

  private def toPayload(row: ConnectorCredentialRow): EncryptedPayload =
    EncryptedPayload(
      keyId          = row.keyId,
      wrappedDataKey = row.wrappedDataKey,
      nonceDek       = row.nonceDek,
      ciphertext     = row.ciphertext,
      nonceValue     = row.nonceValue
    )
}

/** Raised by [[ConnectorCredentialRepository.create]] when encryption fails before any row is
 *  written -- e.g. no master key configured. Never wraps a partially-written row. */
final case class ConnectorCredentialEncryptionFailed(error: MasterKeyError)
    extends RuntimeException(s"Failed to encrypt connector credential: $error")

/** Raised by [[ConnectorCredentialRepository.decryptForUse]] when decryption fails -- wrong/
 *  rotated master key, unknown key id, or a corrupted ciphertext. Never surfaces a decrypted-but-
 *  wrong value. */
final case class ConnectorCredentialDecryptionFailed(error: MasterKeyError)
    extends RuntimeException(s"Failed to decrypt connector credential: $error")

object ConnectorCredentialRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class ConnectorCredentialRow(
      id: UUID,
      userId: UUID,
      name: String,
      keyId: String,
      wrappedDataKey: Array[Byte],
      nonceDek: Array[Byte],
      ciphertext: Array[Byte],
      nonceValue: Array[Byte],
      createdAt: Instant,
      updatedAt: Instant
  )

  class ConnectorCredentialTable(tag: Tag)
      extends Table[ConnectorCredentialRow](tag, "connector_credentials") {
    def id             = column[UUID]("id", O.PrimaryKey)
    def userId         = column[UUID]("user_id")
    def name           = column[String]("name")
    def keyId          = column[String]("key_id")
    def wrappedDataKey = column[Array[Byte]]("wrapped_data_key")
    def nonceDek       = column[Array[Byte]]("nonce_dek")
    def ciphertext     = column[Array[Byte]]("ciphertext")
    def nonceValue     = column[Array[Byte]]("nonce_value")
    def createdAt      = column[Instant]("created_at")
    def updatedAt      = column[Instant]("updated_at")
    def * =
      (id, userId, name, keyId, wrappedDataKey, nonceDek, ciphertext, nonceValue, createdAt, updatedAt) <> (ConnectorCredentialRow.tupled, ConnectorCredentialRow.unapply)
  }
}
