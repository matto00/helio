package com.helio.services.assistant

import com.helio.services.ServiceError
import com.helio.ai.{ClaudeContentBlock, ClaudeToolMessage}
import com.helio.domain.model.{AssistantConversationId, AuthenticatedUser}
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository
import com.helio.infrastructure.storage.FileSystem
import spray.json._

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for HEL-663's assistant-conversation persistence — composes
 *  `AssistantConversationRepository` (Postgres metadata) with the existing `FileSystem`
 *  abstraction (transcript blob, design.md D2). No `AssistantService`/`ClaudeModels` wiring here —
 *  this ticket ships persistence only (ticket.md's scope boundary); a later ticket wires
 *  `AssistantService.converse` to actually load/save through this service. */
final class AssistantConversationService(
    repo: AssistantConversationRepository,
    fileSystem: FileSystem
)(implicit ec: ExecutionContext) {

  import AssistantConversationService._

  // ── Create ────────────────────────────────────────────────────────────────

  /** Creates a brand-new conversation, optionally seeded with a first message (design.md D5).
   *  `title` derivation (design.md D6): an explicit `title` wins outright; otherwise derive from
   *  `firstMessage`'s first `Text` content block, truncated; when NEITHER an explicit `title` NOR a
   *  derivable `Text` block exists (both absent, or `firstMessage` present but text-less — e.g. a
   *  tool-only turn), default to the literal `"New conversation"` — `title TEXT NOT NULL`, this call
   *  shape is reachable and must never throw or leave it unset.
   *
   *  `fileSystem.write` happens FIRST, then the Postgres row is created (write-then-record ordering,
   *  design.md D2, mirrors `ImageUploadService.upload`) — a metadata row is never created pointing at
   *  a blob that doesn't exist yet. */
  def create(
      user: AuthenticatedUser,
      firstMessage: Option[ClaudeToolMessage],
      title: Option[String]
  ): Future[AssistantConversationDetail] = {
    val id            = AssistantConversationId(UUID.randomUUID().toString)
    val resolvedTitle = resolveTitle(title, firstMessage)
    val transcript    = firstMessage.toSeq
    val path          = blobPath(user, id)

    fileSystem.write(path, serialize(transcript)).flatMap { _ =>
      val now = Instant.now()
      repo
        .create(
          AssistantConversationRecord(
            id         = id,
            ownerId    = user.id,
            title      = resolvedTitle,
            pinned     = false,
            gcsBodyRef = path,
            createdAt  = now,
            updatedAt  = now
          )
        )
        .map(record => AssistantConversationDetail(record, transcript.toJson))
    }
  }

  // ── Append ────────────────────────────────────────────────────────────────

  /** Appends `turns` onto an existing, owned conversation (`NotFound` if missing/not-owned — checked
   *  BEFORE any blob read, tasks.md 6.9). Re-writes the WHOLE blob (no partial/append-in-place —
   *  `FileSystem` has no such primitive, design.md D2), then updates `updated_at`/`gcs_body_ref` in
   *  Postgres via `touchUpdatedAt`.
   *
   *  `idempotencyKey` (HEL-698 design.md D3 append-time check, default `None` so the `/messages`
   *  route — today with zero real callers — keeps its exact prior behavior): when the key is defined
   *  AND equals `existing.lastIdempotencyKey`, a concurrent duplicate already applied this send —
   *  skip the blob write and the touch entirely, returning the record as-is (no-op replay). Otherwise
   *  the key (`Some` or `None`) is threaded straight into `touchUpdatedAt`, which owns the
   *  Some-writes/None-leaves-untouched semantics (design.md D2). */
  def appendTurn(
      user: AuthenticatedUser,
      id: AssistantConversationId,
      turns: Seq[ClaudeToolMessage],
      idempotencyKey: Option[String] = None
  ): Future[Either[ServiceError, AssistantConversationRecord]] =
    repo.findById(id, user.id).flatMap {
      case None => Future.successful(Left(conversationNotFound))
      case Some(existing) if idempotencyKey.isDefined && idempotencyKey == existing.lastIdempotencyKey =>
        Future.successful(Right(existing))
      case Some(existing) =>
        fileSystem.read(existing.gcsBodyRef).flatMap { bytes =>
          val updatedTranscript = deserialize(bytes) ++ turns
          fileSystem.write(existing.gcsBodyRef, serialize(updatedTranscript)).flatMap { _ =>
            repo.touchUpdatedAt(id, user.id, existing.gcsBodyRef, idempotencyKey).map {
              case Some(record) => Right(record)
              case None         => Left(conversationNotFound)
            }
          }
        }
    }

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Metadata + the read+deserialized transcript blob, owner-scoped. `Left(NotFound)` for a
   *  missing/foreign-owned id. */
  def get(user: AuthenticatedUser, id: AssistantConversationId): Future[Either[ServiceError, AssistantConversationDetail]] =
    repo.findById(id, user.id).flatMap {
      case None => Future.successful(Left(conversationNotFound))
      case Some(record) =>
        fileSystem.read(record.gcsBodyRef).map { bytes =>
          Right(AssistantConversationDetail(record, deserialize(bytes).toJson))
        }
    }

  /** Pure Postgres query — no blob reads (list is metadata-only, per the design spec's
   *  compact-summary philosophy already established for `find`/HEL-661). `limit` always defaults to
   *  10 when the caller doesn't specify one; the route layer is the one enforcing the "route-local,
   *  NOT `Page.Default.limit`" contract (design.md D5) — this default exists purely so a direct,
   *  non-route caller (e.g. a test) gets the same sane behavior without having to know that detail. */
  def list(user: AuthenticatedUser, limit: Int = DefaultListLimit): Future[Vector[AssistantConversationRecord]] =
    repo.findAll(user.id, limit)

  // ── Pin / rename (Postgres-only, no blob touch) ──────────────────────────────

  def setPinned(user: AuthenticatedUser, id: AssistantConversationId, pinned: Boolean): Future[Either[ServiceError, AssistantConversationRecord]] =
    repo.updatePinned(id, user.id, pinned).map {
      case Some(record) => Right(record)
      case None         => Left(conversationNotFound)
    }

  /** Explicit rename (design.md D6) — overrides whichever title (derived or default) is currently
   *  set, permanently; no re-derivation ever happens once a conversation exists. Not itself listed in
   *  tasks.md 4.1-4.6, but required to satisfy `PATCH /:id`'s documented "pin/unpin, rename" behavior
   *  (tasks.md 5.1/5.2, design.md D5/D6) — mirrors `setPinned`'s exact shape. */
  def rename(user: AuthenticatedUser, id: AssistantConversationId, title: String): Future[Either[ServiceError, AssistantConversationRecord]] =
    repo.updateTitle(id, user.id, title).map {
      case Some(record) => Right(record)
      case None         => Left(conversationNotFound)
    }

  /** `PATCH /:id`'s single combined entry point (design.md D5/D6: "pin/unpin, rename") — sequential
   *  Postgres writes (rename first, then pin, each present-field-only) via `rename`/`setPinned`
   *  above, never duplicating their logic. Neither field present still 404s a missing/foreign-owned
   *  id and otherwise returns the conversation unchanged. */
  def update(
      user: AuthenticatedUser,
      id: AssistantConversationId,
      pinned: Option[Boolean],
      title: Option[String]
  ): Future[Either[ServiceError, AssistantConversationRecord]] = {
    val afterRename: Future[Either[ServiceError, AssistantConversationRecord]] = title match {
      case Some(t) => rename(user, id, t)
      case None =>
        repo.findById(id, user.id).map {
          case Some(record) => Right(record)
          case None         => Left(conversationNotFound)
        }
    }
    afterRename.flatMap {
      case Left(e) => Future.successful(Left(e))
      case Right(record) =>
        pinned match {
          case Some(p) => setPinned(user, id, p)
          case None    => Future.successful(Right(record))
        }
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def blobPath(user: AuthenticatedUser, id: AssistantConversationId): String =
    s"assistant-conversations/${user.id.value}/${id.value}.json"

  private def serialize(transcript: Seq[ClaudeToolMessage]): Array[Byte] =
    transcript.toJson.compactPrint.getBytes(StandardCharsets.UTF_8)

  private def deserialize(bytes: Array[Byte]): Seq[ClaudeToolMessage] =
    new String(bytes, StandardCharsets.UTF_8).parseJson.convertTo[Seq[ClaudeToolMessage]]

  private def conversationNotFound: ServiceError = ServiceError.NotFound("Conversation not found")
}

object AssistantConversationService {
  private[services] val DefaultListLimit: Int = 10
  private[services] val DefaultConversationTitle: String = "New conversation"

  /** Bounded length for a derived title (design.md D6's "truncated to a bounded length, mirroring
   *  how a chat UI's list item needs a short label") — an implementer's choice, no AC pins an exact
   *  number. */
  private[services] val MaxDerivedTitleLength: Int = 80

  /** design.md D6's full title-derivation resolution, including BOTH round-1 design-gate fixes: an
   *  explicit `title` always wins outright; otherwise derive from `firstMessage`'s first `Text`
   *  content block (truncated); when neither exists — `title`/`firstMessage` both absent, OR
   *  `firstMessage` present but carries no non-blank `Text` block (e.g. a tool-only turn, the
   *  round-2 non-blocking note's edge case) — default to the literal `"New conversation"`. Never
   *  throws, never leaves `title` unset (`title TEXT NOT NULL`, V80). */
  private[services] def resolveTitle(title: Option[String], firstMessage: Option[ClaudeToolMessage]): String =
    title.orElse(firstMessage.flatMap(deriveFromFirstMessage)).getOrElse(DefaultConversationTitle)

  private def deriveFromFirstMessage(message: ClaudeToolMessage): Option[String] =
    message.content.collectFirst {
      case ClaudeContentBlock.Text(text) if text.trim.nonEmpty => text.trim
    }.map(truncateTitle)

  private def truncateTitle(text: String): String =
    if (text.length <= MaxDerivedTitleLength) text
    else text.take(MaxDerivedTitleLength).trim + "…"

  /** Service-facing composite `get`/`create` return — metadata plus the transcript, already
   *  serialized to a raw `JsValue` (design.md D3: the route layer's `AssistantConversationProtocol`
   *  never needs its own `ClaudeToolMessage` formatter — the transcript crosses the wire as opaque
   *  JSON, not a typed field). */
  final case class AssistantConversationDetail(record: AssistantConversationRecord, transcript: JsValue)
}
