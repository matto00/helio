package com.helio.infrastructure.persistence.auth

import com.helio.infrastructure.persistence.DbContext
import com.helio.services.auth.OAuthStateStore
import slick.jdbc.PostgresProfile.api._

import java.security.SecureRandom
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1019: Postgres-backed OAuth CSRF state store (`oauth_states`, V105) — replaces the
 *  JVM-wide `ConcurrentHashMap` that lived in `object AuthService`, which lost state whenever the
 *  consent redirect and the callback landed on different Cloud Run processes.
 *
 *  Every access goes through `ctx.withSystemContext` (the `helio_privileged`, BYPASSRLS pool):
 *  this store is written by unauthenticated requests, before any user identity exists, so there
 *  is no `app.current_user_id` to scope a policy to. `oauth_states`' deny-all RLS policy
 *  (V105) makes `withSystemContext` the only path capable of reading or writing this table.
 *
 *  Both the write (`issue`) and read (`validateAndConsume`/pruning) predicates use the SQL `now()`
 *  function rather than a JVM `Instant.now()` bound as a parameter, so expiry is evaluated by the
 *  database's own clock — one fewer cross-instance clock-skew surface (design.md, "preserve the
 *  300-second TTL"). Plain SQL interpolation (not the Slick table DSL) is used specifically so
 *  `now()` is evaluated server-side rather than materialized as a JVM timestamp beforehand. */
class OAuthStateRepository(ctx: DbContext)(implicit ec: ExecutionContext) extends OAuthStateStore {

  private val rng = new SecureRandom()

  /** Generates a 16-byte hex (32-char) CSRF state token, inserts it with an `expires_at` computed
   *  by Postgres as `now() + <ttl>`, and prunes expired rows on the same write. Byte-identical
   *  token shape to the pre-HEL-1019 in-memory generator. No caller-facing failure mode changes:
   *  an insert failure fails the enclosing `Future`, which `OAuthRoutes` already surfaces as a
   *  500. */
  override def issue(): Future[String] = {
    val bytes = new Array[Byte](16)
    rng.nextBytes(bytes)
    val state = bytes.map("%02x".format(_)).mkString
    val ttlSeconds = OAuthStateStore.TtlSeconds

    val insertAction = sqlu"""
      INSERT INTO oauth_states (state, expires_at)
      VALUES ($state, now() + interval '1 second' * $ttlSeconds)
    """

    // No request-bound user exists for an unauthenticated OAuth-initiation request — this path
    // MUST run on the privileged pool; `oauth_states`' deny-all policy is the only thing
    // enforcing that (DbContext.scala).
    ctx.withSystemContext(insertAction andThen pruneAction).map(_ => state)
  }

  /** Atomic single-statement `DELETE FROM oauth_states WHERE state = ? AND expires_at > now()` —
   *  not a read followed by a delete, so concurrent validations of the same state contend on the
   *  same row and at most one deletes it (single-use, HEL-1019 design.md). The affected-row count
   *  (`.map(_ > 0)`), not a `RETURNING` clause, is what Slick's `sqlu` interpolation exposes here;
   *  the atomicity guarantee comes from the single statement, not from `RETURNING`. Returns `true`
   *  iff a row was deleted. */
  override def validateAndConsume(state: String): Future[Boolean] = {
    val action = sqlu"DELETE FROM oauth_states WHERE state = $state AND expires_at > now()"
    // No request-bound user exists for an unauthenticated OAuth-callback request — same
    // privileged-pool justification as `issue` above.
    ctx.withSystemContext(action).map(_ > 0)
  }

  /** Deletes every row whose TTL has elapsed, evaluated by the database clock (`expires_at <=
   *  now()`). Run opportunistically on every `issue` (design.md: "pruning is expiry-driven, not a
   *  scheduled job") — the table's steady-state size is bounded by the login rate over one TTL
   *  window, so no separate cadence knob is needed. Never removes an unexpired row: this
   *  predicate is the complement of the one `validateAndConsume` requires for a row to still be
   *  valid. */
  private def pruneAction =
    sqlu"DELETE FROM oauth_states WHERE expires_at <= now()"
}
