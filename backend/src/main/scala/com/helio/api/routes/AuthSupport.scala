package com.helio.api.routes

import com.helio.domain.{UserId, UserSession}
import com.helio.infrastructure.UserRepository

import java.security.SecureRandom
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}

/** Shared helpers for credential-based (`AuthRoutes`) and OAuth (`OAuthRoutes`) flows.
 *  Kept small and stateful so both route classes can mix in the same in-memory CSRF
 *  state store. */
object AuthSupport {
  private val rng = new SecureRandom()

  def generateSessionToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    bytes.map("%02x".format(_)).mkString
  }

  def buildSession(userId: UserId): UserSession = {
    val now = Instant.now()
    UserSession(
      token     = generateSessionToken(),
      userId    = userId,
      createdAt = now,
      expiresAt = now.plusSeconds(30L * 24 * 60 * 60)
    )
  }

  def createSession(userRepo: UserRepository, userId: UserId)(implicit ec: ExecutionContext): Future[UserSession] =
    userRepo.createSession(buildSession(userId))

  // In-memory CSRF state store: state -> expiry (epochSecond)
  // In production, this would be a session cookie or distributed store.
  private val csrfStateStore     = new ConcurrentHashMap[String, Long]()
  private val CsrfStateTtlSeconds = 300L // 5 minutes

  def generateCsrfState(): String = {
    val bytes = new Array[Byte](16)
    rng.nextBytes(bytes)
    val state = bytes.map("%02x".format(_)).mkString
    csrfStateStore.put(state, Instant.now().getEpochSecond + CsrfStateTtlSeconds)
    state
  }

  def validateCsrfState(state: String): Boolean = {
    val expiryOpt = Option(csrfStateStore.remove(state))
    expiryOpt.exists(_ > Instant.now().getEpochSecond)
  }
}
