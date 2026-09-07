package com.helio.services.auth

import scala.concurrent.Future

/** HEL-1019: collaborator interface for OAuth CSRF state issuance/validation, injected into
 *  [[AuthService]] rather than living in a JVM-wide singleton. This is the seam that makes a
 *  cross-process round-trip test possible at all — two independently constructed
 *  [[OAuthStateRepository]]s (see `com.helio.infrastructure.persistence.auth`) backed by the same
 *  Postgres database share NO in-memory state, unlike the pre-HEL-1019 `object AuthService`
 *  companion map, which made two `new AuthService(...)` instances share one store. */
trait OAuthStateStore {

  /** Issues a new state value, valid for [[OAuthStateStore.TtlSeconds]]. */
  def issue(): Future[String]

  /** Atomically validates and consumes `state`. Returns `true` iff `state` was previously issued,
   *  has not expired, and has not already been consumed by a prior call — every subsequent call
   *  with the same value returns `false`. */
  def validateAndConsume(state: String): Future[Boolean]
}

object OAuthStateStore {

  /** 5-minute TTL, unchanged from the pre-HEL-1019 in-memory store
   *  (`AuthService.CsrfStateTtlSeconds`). */
  val TtlSeconds: Long = 300L
}
