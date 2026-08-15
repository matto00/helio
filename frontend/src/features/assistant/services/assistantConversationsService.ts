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
