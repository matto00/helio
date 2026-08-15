// TypeScript mirrors of HEL-663's wire shapes (design.md D5/D7) —
// `AssistantConversationProtocol.scala` (summary/detail response bodies) and
// `AssistantConversationRepository`'s repository-internal `ClaudeContentBlock`/
// `ClaudeToolMessage` spray-json format (the transcript blob's own JSON
// shape, discriminated on `blockType`). No backend/schema work in this
// ticket — every field here already exists on the shipped API.

/** `GET /api/assistant-conversations` list-item shape — deliberately compact,
 * no transcript. */
export interface AssistantConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

/** `GET /api/assistant-conversations/:id` shape — summary fields plus the
 * full transcript. `hopBudgetExhausted`/`searchedWithNoResults` (HEL-667
 * design.md D1) are ephemeral signals describing the turn that just
 * completed: present only on a `POST /:id/converse` response, always
 * absent (`undefined`) on `GET`. */
export interface AssistantConversationDetail extends AssistantConversationSummary {
  transcript: ClaudeToolMessageDto[];
  hopBudgetExhausted?: boolean;
  searchedWithNoResults?: boolean;
}

/** Mirrors `com.helio.ai.ClaudeToolMessage` — one turn of the tool-use-loop
 * conversation. */
export interface ClaudeToolMessageDto {
  role: string;
  content: ClaudeContentBlockDto[];
}

/** Mirrors `com.helio.ai.ClaudeContentBlock`'s discriminated union, using the
 * exact `blockType` discriminator `AssistantConversationRepository`'s
 * hand-written formatter puts on the wire. */
export type ClaudeContentBlockDto =
  | { blockType: "text"; text: string }
  | { blockType: "tool_use"; id: string; name: string; input: unknown }
  | { blockType: "tool_result"; toolUseId: string; content: string; isError: boolean };

// HEL-665 — narrowed per-variant aliases, shared by MessageTurn/ToolCallIndicator/
// proposalExtraction so every consumer of one block kind uses the same narrowed type.
export type ClaudeTextBlockDto = Extract<ClaudeContentBlockDto, { blockType: "text" }>;
export type ClaudeToolUseBlockDto = Extract<ClaudeContentBlockDto, { blockType: "tool_use" }>;
export type ClaudeToolResultBlockDto = Extract<ClaudeContentBlockDto, { blockType: "tool_result" }>;
