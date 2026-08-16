package com.helio.services

import com.helio.api.protocols.CreateAgentMemoryRequest
import com.helio.domain.{AgentMemoryEntry, AgentMemoryId, AgentMemoryKind, AuthenticatedUser}
import com.helio.infrastructure.AgentMemoryRepository

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/agent/memory` (HEL-478 / 420-B). Validates `kind` (via
 *  [[AgentMemoryKind.fromString]]) and rejects blank `content` before delegating to
 *  [[AgentMemoryRepository]] -- mirrors `RequestValidation.validateCreateApiTokenRequest`'s
 *  blank-name rejection pattern (design.md).
 *
 *  `MaxEntriesPerUser` is the one knob 420-E's eventual retention-policy ticket can widen without
 *  touching `AgentMemoryRepository`'s eviction query itself (design.md Risks). */
final class AgentMemoryService(repo: AgentMemoryRepository)(implicit ec: ExecutionContext) {

  private val MaxEntriesPerUser = 100

  /** Validates `kind` against the closed allow-list and rejects blank `content`, then persists
   *  under the caller's own id/timestamps -- `id`/`ownerId`/`createdAt`/`lastUsedAt` are always
   *  set here, never taken from the wire request. */
  def add(req: CreateAgentMemoryRequest, user: AuthenticatedUser): Future[Either[ServiceError, AgentMemoryEntry]] = {
    val content = req.content.trim
    AgentMemoryKind.fromString(req.kind) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) if content.isEmpty =>
        Future.successful(Left(ServiceError.BadRequest("content is required")))
      case Right(kind) =>
        val entry = AgentMemoryEntry(
          id         = AgentMemoryId(UUID.randomUUID().toString),
          ownerId    = user.id,
          kind       = kind,
          content    = content,
          createdAt  = Instant.now(),
          lastUsedAt = None
        )
        repo.add(entry, MaxEntriesPerUser).map(Right(_))
    }
  }

  /** The caller's stored entries, newest-first (never fails -- wrapped in `Right` purely so
   *  route wiring can share `ServiceResponse.run`, mirroring `ApiTokenService.list`). */
  def list(user: AuthenticatedUser): Future[Either[ServiceError, Seq[AgentMemoryEntry]]] =
    repo.list(user).map(entries => Right(entries))

  /** Bumps `lastUsedAt` to now -- a thin delegate to `AgentMemoryRepository.touch` (HEL-521 /
   *  420-C), called by `WorkspaceContextService.assemble` for every memory entry it surfaces in
   *  `agentContext.memory`, so 420-B's LRU eviction order reflects real usage. A no-op (not an
   *  error) for an unknown or cross-user id, mirroring the repository's own no-op semantics. */
  def touch(id: AgentMemoryId, user: AuthenticatedUser): Future[Unit] =
    repo.touch(id, user)

  /** Existence-not-leaked: unknown and cross-user ids both map to 404. */
  def delete(id: AgentMemoryId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    repo.delete(id, user).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound("Memory entry not found"))
    }

  /** Always succeeds -- clearing an already-empty memory is not an error (design.md Decision 5). */
  def clear(user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    repo.clear(user).map(_ => Right(()))
}
