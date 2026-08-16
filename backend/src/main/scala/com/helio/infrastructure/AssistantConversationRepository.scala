package com.helio.infrastructure

import com.helio.ai.{ClaudeContentBlock, ClaudeToolMessage}
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for the `assistant_conversations` table (HEL-663 design.md D1) —
 *  mirrors `AuthoringConversationRepository`'s `withUserContext` + owner-filter conventions exactly.
 *  Unlike `AuthoringConversationRepository` (which stores its full transcript as `api_history JSONB`
 *  in Postgres), this repository is PURE METADATA CRUD — the transcript body lives outside Postgres
 *  entirely, via the `FileSystem` abstraction `AssistantConversationService` composes this repository
 *  with (design.md D2). `gcsBodyRef` here is just the blob's path string; this repository never reads
 *  or writes the blob itself. */
class AssistantConversationRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AssistantConversationRepository._

  private val table = TableQuery[AssistantConversationTable]

  private def rowToRecord(row: AssistantConversationRow): AssistantConversationRecord =
    AssistantConversationRecord(
      id                 = AssistantConversationId(row.id),
      ownerId            = UserId(row.ownerId.toString),
      title              = row.title,
      pinned             = row.pinned,
      gcsBodyRef         = row.gcsBodyRef,
      createdAt          = row.createdAt,
      updatedAt          = row.updatedAt,
      lastIdempotencyKey = row.lastIdempotencyKey
    )

  private def recordToRow(r: AssistantConversationRecord): AssistantConversationRow =
    AssistantConversationRow(
      id                 = r.id.value,
      ownerId            = UUID.fromString(r.ownerId.value),
      title              = r.title,
      pinned             = r.pinned,
      gcsBodyRef         = r.gcsBodyRef,
      createdAt          = r.createdAt,
      updatedAt          = r.updatedAt,
      lastIdempotencyKey = r.lastIdempotencyKey
    )

  /** Inserts a brand-new conversation row. Runs in `record.ownerId`'s user context so the V80 RLS
   *  policy's `WITH CHECK` (implied by the bare `USING` clause on `INSERT`) is satisfied. Callers
   *  (`AssistantConversationService.create`) are expected to have already written the transcript
   *  blob via `FileSystem.write` BEFORE calling this — write-then-record ordering, design.md D2. */
  def create(record: AssistantConversationRecord): Future[AssistantConversationRecord] =
    ctx.withUserContext(record.ownerId.value)(table += recordToRow(record)).map(_ => record)

  /** Owner-scoped findById — RLS-scoped via `withUserContext` AND an explicit `ownerId` filter
   *  (defense-in-depth, mirrors `AuthoringConversationRepository.findById`/`MetricRepository.
   *  findByIdOwned`). A missing id and a foreign-owned id are indistinguishable: both resolve to
   *  `None` (CONTRIBUTING's ACL triad — existence is never leaked to a non-owner). */
  def findById(id: AssistantConversationId, ownerId: UserId): Future[Option[AssistantConversationRecord]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToRecord))
  }

  /** Owner-scoped, pinned-first list (design.md D1/D5) — `ORDER BY pinned DESC, updated_at DESC`,
   *  sliced to `limit` at the DB level. `limit` is always caller-resolved (the route's own
   *  route-local default of 10, clamped to `Page.MaxLimit` — design.md D5, NOT `Page.Default.limit`);
   *  this method applies whatever `limit` it's given with no default of its own opinion here. */
  def findAll(ownerId: UserId, limit: Int): Future[Vector[AssistantConversationRecord]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table
        .filter(_.ownerId === ownerUuid)
        .sortBy(r => (r.pinned.desc, r.updatedAt.desc))
        .take(limit)
        .result
    ).map(_.map(rowToRecord).toVector)
  }

  /** Postgres-only pin/unpin toggle — no blob touch (`AssistantConversationService.setPinned`,
   *  design.md D5). Update-then-reselect, mirroring `AuthoringConversationRepository.appendTurn`'s
   *  shape. Returns `None` for a missing/foreign-owned id. */
  def updatePinned(id: AssistantConversationId, ownerId: UserId, pinned: Boolean): Future[Option[AssistantConversationRecord]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val action = table
      .filter(r => r.id === id.value && r.ownerId === ownerUuid)
      .map(_.pinned)
      .update(pinned)
      .andThen(table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption)
      .map(_.map(rowToRecord))
    ctx.withUserContext(ownerId.value)(action)
  }

  /** Postgres-only rename — no blob touch. Not itself enumerated in tasks.md 3.1's method list, but
   *  required by design.md D6 / tasks.md 5.1-5.2: `PATCH /:id` supports rename as well as pin/unpin,
   *  and a rename "overrides whichever title (derived or default) is currently set, permanently."
   *  Mirrors `updatePinned`'s exact shape. */
  def updateTitle(id: AssistantConversationId, ownerId: UserId, title: String): Future[Option[AssistantConversationRecord]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val action = table
      .filter(r => r.id === id.value && r.ownerId === ownerUuid)
      .map(_.title)
      .update(title)
      .andThen(table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption)
      .map(_.map(rowToRecord))
    ctx.withUserContext(ownerId.value)(action)
  }

  /** Called after `AssistantConversationService.appendTurn` re-writes the WHOLE transcript blob
   *  (design.md D2/tasks.md 4.3) — updates `gcs_body_ref` (stable in practice, since the blob's path
   *  is derived from the conversation id, but threaded through explicitly rather than assumed) and
   *  `updated_at` together, which is what feeds the list endpoint's recency ordering. Returns `None`
   *  for a missing/foreign-owned id.
   *
   *  `lastIdempotencyKey` (HEL-698 design.md D2/D3): `Some(key)` writes `last_idempotency_key` in the
   *  SAME update tuple as `gcs_body_ref`/`updated_at` — key and metadata touch land atomically.
   *  `None` (the default — every pre-HEL-698 call site keeps working unchanged) leaves the column
   *  UNTOUCHED: an unrelated keyless append must never un-protect an outstanding keyed retry. */
  def touchUpdatedAt(
      id: AssistantConversationId,
      ownerId: UserId,
      gcsBodyRef: String,
      lastIdempotencyKey: Option[String] = None
  ): Future[Option[AssistantConversationRecord]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val now = Instant.now()
    val filtered = table.filter(r => r.id === id.value && r.ownerId === ownerUuid)
    val updateAction = lastIdempotencyKey match {
      case Some(key) => filtered.map(r => (r.gcsBodyRef, r.updatedAt, r.lastIdempotencyKey)).update((gcsBodyRef, now, Some(key)))
      case None      => filtered.map(r => (r.gcsBodyRef, r.updatedAt)).update((gcsBodyRef, now))
    }
    val action = updateAction
      .andThen(filtered.result.headOption)
      .map(_.map(rowToRecord))
    ctx.withUserContext(ownerId.value)(action)
  }
}

object AssistantConversationRepository extends DefaultJsonProtocol {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** `ClaudeContentBlock`/`ClaudeToolMessage` (`com.helio.ai`) have no spray-json formatter before
   *  this ticket — no prior consumer ever serialized them (design.md D3). Hand-written (a genuine
   *  sealed-trait discriminated union for `ClaudeContentBlock`, mirroring `ClaudeApiContentBlock`'s
   *  formatter style in `ClaudeProtocol.scala`; `jsonFormat2` for `ClaudeToolMessage`) and declared
   *  HERE, repository-internal — mirrors `AuthoringConversationRepository`'s own existing
   *  `claudeMessageFormat` precedent ("never wire-exposed... so its JSON format lives here"). These
   *  format the TRANSCRIPT BLOB's JSON shape only — `AssistantConversationService` imports them to
   *  serialize/deserialize the `Seq[ClaudeToolMessage]` it reads/writes via `FileSystem` (design.md
   *  D2) — never the HTTP API's own wire shape, which `AssistantConversationProtocol.scala` owns
   *  independently (metadata-facing request/response types only). */
  implicit val claudeContentBlockFormat: RootJsonFormat[ClaudeContentBlock] =
    new RootJsonFormat[ClaudeContentBlock] {
      def write(b: ClaudeContentBlock): JsValue = b match {
        case ClaudeContentBlock.Text(text) =>
          JsObject("blockType" -> JsString("text"), "text" -> JsString(text))
        case ClaudeContentBlock.ToolUse(id, name, input) =>
          JsObject(
            "blockType" -> JsString("tool_use"),
            "id"        -> JsString(id),
            "name"      -> JsString(name),
            "input"     -> input
          )
        case ClaudeContentBlock.ToolResult(toolUseId, content, isError) =>
          JsObject(
            "blockType" -> JsString("tool_result"),
            "toolUseId" -> JsString(toolUseId),
            "content"   -> JsString(content),
            "isError"   -> JsBoolean(isError)
          )
      }

      def read(json: JsValue): ClaudeContentBlock = {
        val obj = json.asJsObject
        obj.fields.get("blockType").map(_.convertTo[String]) match {
          case Some("text") =>
            ClaudeContentBlock.Text(obj.fields("text").convertTo[String])
          case Some("tool_use") =>
            ClaudeContentBlock.ToolUse(
              id    = obj.fields("id").convertTo[String],
              name  = obj.fields("name").convertTo[String],
              input = obj.fields("input")
            )
          case Some("tool_result") =>
            ClaudeContentBlock.ToolResult(
              toolUseId = obj.fields("toolUseId").convertTo[String],
              content   = obj.fields("content").convertTo[String],
              isError   = obj.fields.get("isError").map(_.convertTo[Boolean]).getOrElse(false)
            )
          case other =>
            deserializationError(s"Unknown ClaudeContentBlock blockType: $other")
        }
      }
    }

  implicit val claudeToolMessageFormat: RootJsonFormat[ClaudeToolMessage] = jsonFormat2(ClaudeToolMessage.apply)

  /** The repository-facing shape — value-class-typed, mirrors `AuthoringConversationRecord`'s role
   *  for `AuthoringConversationRepository`. `gcsBodyRef` is the transcript blob's `FileSystem` path
   *  (`assistant-conversations/{userId}/{conversationId}.json`, design.md D2) — never the blob's
   *  content itself, which this repository never reads. `lastIdempotencyKey` (HEL-698 design.md D2)
   *  is the key of the most recent KEYED append — `None` until the first keyed append ever occurs;
   *  defaults to `None` so `AssistantConversationService.create`'s existing named-arg construction
   *  site needs no change. */
  final case class AssistantConversationRecord(
      id: AssistantConversationId,
      ownerId: UserId,
      title: String,
      pinned: Boolean,
      gcsBodyRef: String,
      createdAt: Instant,
      updatedAt: Instant,
      lastIdempotencyKey: Option[String] = None
  )

  private[infrastructure] case class AssistantConversationRow(
      id: String,
      ownerId: UUID,
      title: String,
      pinned: Boolean,
      gcsBodyRef: String,
      createdAt: Instant,
      updatedAt: Instant,
      lastIdempotencyKey: Option[String]
  )

  private[infrastructure] class AssistantConversationTable(tag: Tag)
      extends Table[AssistantConversationRow](tag, "assistant_conversations") {
    def id                 = column[String]("id", O.PrimaryKey)
    def ownerId            = column[UUID]("owner_id")
    def title              = column[String]("title")
    def pinned             = column[Boolean]("pinned")
    def gcsBodyRef         = column[String]("gcs_body_ref")
    def createdAt          = column[Instant]("created_at")
    def updatedAt          = column[Instant]("updated_at")
    def lastIdempotencyKey = column[Option[String]]("last_idempotency_key")

    def * =
      (id, ownerId, title, pinned, gcsBodyRef, createdAt, updatedAt, lastIdempotencyKey)
        .mapTo[AssistantConversationRow]
  }
}
