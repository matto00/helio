package com.helio.infrastructure

import com.helio.domain.{MfaLoginChallenge, UserId, UserMfa}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for TOTP MFA (HEL-702): `user_mfa`, `mfa_backup_codes`,
 *  `mfa_login_challenges`. Raw `JdbcBackend.Database`, not [[DbContext]] —
 *  all three tables are read pre-identity on the login path (V89's
 *  migration comment, design.md D2), exactly like [[UserRepository]]'s
 *  `users`/`user_sessions`; none carry row-level security. */
class MfaRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import MfaRepository._

  private val userMfaTable = TableQuery[UserMfaTable]
  private val backupCodes  = TableQuery[BackupCodeTable]
  private val challenges   = TableQuery[ChallengeTable]

  // ── user_mfa ──────────────────────────────────────────────────────────────

  def findUserMfa(userId: UserId): Future[Option[UserMfa]] =
    db.run(userMfaTable.filter(_.userId === UUID.fromString(userId.value)).result.headOption)
      .map(_.map(rowToDomain))

  /** Insert-or-replace the caller's secret row — used by enrollment start
   *  (a fresh, unconfirmed secret; re-issuing replaces any prior
   *  unconfirmed one). Confirmation itself goes through
   *  [[confirmEnrollment]], not this method. */
  def upsertUserMfa(mfa: UserMfa): Future[Unit] =
    db.run(userMfaTable.insertOrUpdate(toRow(mfa))).map(_ => ())

  def confirmEnrollment(userId: UserId, verifiedStep: Long, verifiedAt: Instant): Future[Unit] =
    db.run(
      userMfaTable
        .filter(_.userId === UUID.fromString(userId.value))
        .map(t => (t.enabled, t.lastUsedStep, t.verifiedAt))
        .update((true, verifiedStep, Some(verifiedAt)))
    ).map(_ => ())

  /** Compare-and-set replay guard (design.md D5): only advances when
   *  `newStep` is strictly greater than the stored value, so a concurrent
   *  duplicate verification can never move the watermark backwards. */
  def updateLastUsedStep(userId: UserId, newStep: Long): Future[Unit] =
    db.run(
      userMfaTable
        .filter(t => t.userId === UUID.fromString(userId.value) && t.lastUsedStep < newStep)
        .map(_.lastUsedStep)
        .update(newStep)
    ).map(_ => ())

  /** Deletes the user's MFA enrollment and every backup code in one
   *  transaction — `mfa_backup_codes` has no FK to `user_mfa` (only to
   *  `users`), so both deletes are explicit here rather than relying on
   *  cascade. */
  def deleteUserMfa(userId: UserId): Future[Unit] = {
    val uuid = UUID.fromString(userId.value)
    val action = for {
      _ <- backupCodes.filter(_.userId === uuid).delete
      _ <- userMfaTable.filter(_.userId === uuid).delete
    } yield ()
    db.run(action.transactionally)
  }

  // ── mfa_backup_codes ─────────────────────────────────────────────────────

  def insertBackupCodes(userId: UserId, hashes: Seq[String]): Future[Unit] = {
    val uuid = UUID.fromString(userId.value)
    val now  = Instant.now()
    val rows = hashes.map(hash => BackupCodeRow(UUID.randomUUID(), uuid, hash, None, now))
    db.run(backupCodes ++= rows).map(_ => ())
  }

  def deleteAllBackupCodes(userId: UserId): Future[Unit] =
    db.run(backupCodes.filter(_.userId === UUID.fromString(userId.value)).delete).map(_ => ())

  def countUnusedBackupCodes(userId: UserId): Future[Int] =
    db.run(
      backupCodes
        .filter(c => c.userId === UUID.fromString(userId.value) && c.usedAt.isEmpty)
        .length
        .result
    )

  /** Atomic single-use consumption: `true` iff an unused row matched `hash`
   *  and was marked used by THIS call. */
  def consumeBackupCode(userId: UserId, hash: String): Future[Boolean] =
    db.run(
      backupCodes
        .filter(c => c.userId === UUID.fromString(userId.value) && c.codeHash === hash && c.usedAt.isEmpty)
        .map(_.usedAt)
        .update(Some(Instant.now()))
    ).map(_ > 0)

  // ── mfa_login_challenges ─────────────────────────────────────────────────

  def createChallenge(challenge: MfaLoginChallenge): Future[MfaLoginChallenge] = {
    val row = ChallengeRow(
      id        = UUID.randomUUID(),
      userId    = UUID.fromString(challenge.userId.value),
      tokenHash = TokenHashing.sha256Hex(challenge.token),
      attempts  = challenge.attempts,
      createdAt = challenge.createdAt,
      expiresAt = challenge.expiresAt
    )
    db.run(challenges += row).map(_ => challenge)
  }

  /** Hashes the incoming raw `token` before querying (mirrors
   *  [[UserRepository.findSession]]) — the raw value is never compared
   *  against the database. */
  def findChallengeByToken(token: String): Future[Option[MfaLoginChallenge]] =
    db.run(challenges.filter(_.tokenHash === TokenHashing.sha256Hex(token)).result.headOption)
      .map(_.map(challengeRowToDomain(_, token)))

  /** `attempts = attempts + 1` — expressed as a raw statement since Slick's
   *  lifted `.update` API takes a constant value, not a query-relative
   *  expression (mirrors `DataTypeRowRepository`'s use of `sqlu` for the
   *  cases the lifted API can't express). */
  def incrementChallengeAttempts(token: String): Future[Unit] = {
    val hash = TokenHashing.sha256Hex(token)
    db.run(sqlu"UPDATE mfa_login_challenges SET attempts = attempts + 1 WHERE token_hash = $hash").map(_ => ())
  }

  def deleteChallenge(token: String): Future[Unit] =
    db.run(challenges.filter(_.tokenHash === TokenHashing.sha256Hex(token)).delete).map(_ => ())

  // ── Row <-> domain ───────────────────────────────────────────────────────

  private def rowToDomain(row: UserMfaRow): UserMfa =
    UserMfa(
      userId       = UserId(row.userId.toString),
      totpSecret   = row.totpSecret,
      enabled      = row.enabled,
      lastUsedStep = row.lastUsedStep,
      createdAt    = row.createdAt,
      verifiedAt   = row.verifiedAt
    )

  private def toRow(mfa: UserMfa): UserMfaRow =
    UserMfaRow(
      userId       = UUID.fromString(mfa.userId.value),
      totpSecret   = mfa.totpSecret,
      enabled      = mfa.enabled,
      lastUsedStep = mfa.lastUsedStep,
      createdAt    = mfa.createdAt,
      verifiedAt   = mfa.verifiedAt
    )

  private def challengeRowToDomain(row: ChallengeRow, rawToken: String): MfaLoginChallenge =
    MfaLoginChallenge(
      userId    = UserId(row.userId.toString),
      token     = rawToken,
      attempts  = row.attempts,
      createdAt = row.createdAt,
      expiresAt = row.expiresAt
    )
}

object MfaRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class UserMfaRow(
      userId: UUID,
      totpSecret: String,
      enabled: Boolean,
      lastUsedStep: Long,
      createdAt: Instant,
      verifiedAt: Option[Instant]
  )

  final case class BackupCodeRow(
      id: UUID,
      userId: UUID,
      codeHash: String,
      usedAt: Option[Instant],
      createdAt: Instant
  )

  final case class ChallengeRow(
      id: UUID,
      userId: UUID,
      tokenHash: String,
      attempts: Int,
      createdAt: Instant,
      expiresAt: Instant
  )

  class UserMfaTable(tag: Tag) extends Table[UserMfaRow](tag, "user_mfa") {
    def userId       = column[UUID]("user_id", O.PrimaryKey)
    def totpSecret   = column[String]("totp_secret")
    def enabled      = column[Boolean]("enabled")
    def lastUsedStep = column[Long]("last_used_step")
    def createdAt    = column[Instant]("created_at")
    def verifiedAt   = column[Option[Instant]]("verified_at")
    def * = (userId, totpSecret, enabled, lastUsedStep, createdAt, verifiedAt) <> (UserMfaRow.tupled, UserMfaRow.unapply)
  }

  class BackupCodeTable(tag: Tag) extends Table[BackupCodeRow](tag, "mfa_backup_codes") {
    def id        = column[UUID]("id", O.PrimaryKey)
    def userId    = column[UUID]("user_id")
    def codeHash  = column[String]("code_hash")
    def usedAt    = column[Option[Instant]]("used_at")
    def createdAt = column[Instant]("created_at")
    def * = (id, userId, codeHash, usedAt, createdAt) <> (BackupCodeRow.tupled, BackupCodeRow.unapply)
  }

  class ChallengeTable(tag: Tag) extends Table[ChallengeRow](tag, "mfa_login_challenges") {
    def id        = column[UUID]("id", O.PrimaryKey)
    def userId    = column[UUID]("user_id")
    def tokenHash = column[String]("token_hash")
    def attempts  = column[Int]("attempts")
    def createdAt = column[Instant]("created_at")
    def expiresAt = column[Instant]("expires_at")
    def * = (id, userId, tokenHash, attempts, createdAt, expiresAt) <> (ChallengeRow.tupled, ChallengeRow.unapply)
  }
}
