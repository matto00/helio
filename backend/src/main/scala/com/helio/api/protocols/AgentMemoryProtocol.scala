package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.{AgentMemoryEntry, AgentMemoryKind}
import spray.json._

// ── AgentMemory API types (HEL-478 / 420-B) ──────────────────────────────────

/** `POST /api/agent/memory` request body. `kind` is validated against the closed
 *  `fact`/`goal`/`preference-note` allow-list by `AgentMemoryKind.fromString`
 *  (`AgentMemoryService.add`); `content` is free text, rejected only when blank. */
final case class CreateAgentMemoryRequest(kind: String, content: String)

/** `GET`/`POST /api/agent/memory` response shape -- decoupled from the domain `AgentMemoryEntry`
 *  case class (never echoes `ownerId`; `kind` is the wire string form, timestamps are ISO-8601
 *  strings). */
final case class AgentMemoryEntryResponse(
    id: String,
    kind: String,
    content: String,
    createdAt: String,
    lastUsedAt: Option[String]
)

object AgentMemoryEntryResponse {
  def fromDomain(entry: AgentMemoryEntry): AgentMemoryEntryResponse =
    AgentMemoryEntryResponse(
      id         = entry.id.value,
      kind       = AgentMemoryKind.asString(entry.kind),
      content    = entry.content,
      createdAt  = entry.createdAt.toString,
      lastUsedAt = entry.lastUsedAt.map(_.toString)
    )
}

trait AgentMemoryProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createAgentMemoryRequestFormat: RootJsonFormat[CreateAgentMemoryRequest] = jsonFormat2(CreateAgentMemoryRequest.apply)
  implicit val agentMemoryEntryResponseFormat: RootJsonFormat[AgentMemoryEntryResponse] = jsonFormat5(AgentMemoryEntryResponse.apply)
}
