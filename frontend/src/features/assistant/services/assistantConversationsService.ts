import { httpClient } from "../../../services/httpClient";
import type {
  AssistantConversationDetail,
  AssistantConversationSummary,
  ClaudeToolMessageDto,
} from "../types";

// One async function per HEL-663 endpoint, mirroring `dataSourceService.ts`'s
// shape (design.md D5). `GET /api/assistant-conversations` returns a plain
// array — unlike the `PagedResult<T>`-wrapped list endpoints elsewhere in
// this codebase, `AssistantConversationRoutes` completes with
// `records.map(summaryOf)` directly.

const BASE_PATH = "/api/assistant-conversations";

export interface CreateConversationRequest {
  title?: string;
  firstMessage?: ClaudeToolMessageDto;
}

export interface UpdateConversationRequest {
  pinned?: boolean;
  title?: string;
}

export async function listConversations(): Promise<AssistantConversationSummary[]> {
  const response = await httpClient.get<AssistantConversationSummary[]>(BASE_PATH);
  return response.data;
}

export async function createConversation(
  request: CreateConversationRequest,
): Promise<AssistantConversationDetail> {
  const response = await httpClient.post<AssistantConversationDetail>(BASE_PATH, request);
  return response.data;
}

export async function getConversation(id: string): Promise<AssistantConversationDetail> {
  const response = await httpClient.get<AssistantConversationDetail>(`${BASE_PATH}/${id}`);
  return response.data;
}

export async function appendTurns(
  id: string,
  turns: ClaudeToolMessageDto[],
): Promise<AssistantConversationSummary> {
  const response = await httpClient.post<AssistantConversationSummary>(
    `${BASE_PATH}/${id}/messages`,
    { turns },
  );
  return response.data;
}

export async function updateConversation(
  id: string,
  updates: UpdateConversationRequest,
): Promise<AssistantConversationSummary> {
  const response = await httpClient.patch<AssistantConversationSummary>(
    `${BASE_PATH}/${id}`,
    updates,
  );
  return response.data;
}

/** `POST /:id/converse` (HEL-665, reopened composer ticket) — sends one typed message and returns
 * the refreshed conversation detail (the whole transcript, already including the new user turn and
 * Claude's response, per `AssistantConversationRoutes`'s fetch → converse → append → re-fetch
 * flow). No follow-up `getConversation` call needed.
 *
 * `idempotencyKey` (HEL-698 design.md D5/D6) — optional client-generated retry key. Omitted from
 * the request body entirely when `undefined` (mirrors every other optional field in this file),
 * matching the backend's `Option[String]` -> spray-json-omits-`None` wire contract. */
export async function converse(
  id: string,
  message: string,
  idempotencyKey?: string,
): Promise<AssistantConversationDetail> {
  const response = await httpClient.post<AssistantConversationDetail>(
    `${BASE_PATH}/${id}/converse`,
    { message, idempotencyKey },
  );
  return response.data;
}
