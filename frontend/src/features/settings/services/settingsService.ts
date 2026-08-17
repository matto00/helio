import { httpClient } from "../../../services/httpClient";
import type { AgentPreferences, PutAgentPreferencesRequest } from "../types/preferences";
import type { AgentMemoryEntry } from "../types/agentMemory";
import type { User } from "../../auth/types/user";

/** spray-json's default `Option` formatter omits `None` fields from the wire
 *  entirely rather than serializing `null` (documented codebase gotcha, see
 *  `pipelineService.ts`'s `normalizeSchedule`) -- the backend's
 *  `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` are all
 *  `Option[...]`, so an unset value deserializes as `undefined`, not `null`.
 *  Normalize here, at the service boundary, so no caller has to special-case
 *  `undefined` vs `null` and `AgentPreferences`'s declared `| null` type
 *  stays accurate to what callers actually receive. `extras` is never
 *  optional on the wire (always at least `{}`), but default it defensively
 *  too in case a legacy/mocked response omits it. */
function normalizePreferences(prefs: AgentPreferences): AgentPreferences {
  return {
    defaultSeriesColors: prefs.defaultSeriesColors ?? null,
    defaultPanelStyle: prefs.defaultPanelStyle ?? null,
    namingConventions: prefs.namingConventions ?? null,
    extras: prefs.extras ?? {},
  };
}

/** Same `Option`-omission gotcha applies to `lastUsedAt` (`Option[Instant]` on
 *  the backend) -- a never-used entry arrives with the key absent. */
function normalizeMemoryEntry(entry: AgentMemoryEntry): AgentMemoryEntry {
  return { ...entry, lastUsedAt: entry.lastUsedAt ?? null };
}

/** `GET /api/preferences`. Returns the default/empty-shaped object (all
 *  fields `null`/`{}`) when the caller has no stored preferences yet -- never
 *  a 404 (`AgentPreferencesRoutes.scala`'s `get` always succeeds). */
export async function getPreferences(): Promise<AgentPreferences> {
  const response = await httpClient.get<AgentPreferences>("/api/preferences");
  return normalizePreferences(response.data);
}

/** `PUT /api/preferences` -- a full replace (design.md Decision 4). Callers
 *  must send the complete, merged object for every field they want
 *  preserved; the backend clears anything omitted. */
export async function putPreferences(
  request: PutAgentPreferencesRequest,
): Promise<AgentPreferences> {
  const response = await httpClient.put<AgentPreferences>("/api/preferences", request);
  return normalizePreferences(response.data);
}

/** `GET /api/agent/memory` -- every stored entry for the caller. */
export async function listAgentMemory(): Promise<AgentMemoryEntry[]> {
  const response = await httpClient.get<AgentMemoryEntry[]>("/api/agent/memory");
  return response.data.map(normalizeMemoryEntry);
}

/** `DELETE /api/agent/memory/:id` -- removes a single entry. */
export async function deleteAgentMemoryEntry(id: string): Promise<void> {
  await httpClient.delete(`/api/agent/memory/${id}`);
}

/** `DELETE /api/agent/memory` -- removes every stored entry for the caller
 *  ("Clear all"). */
export async function clearAgentMemory(): Promise<void> {
  await httpClient.delete("/api/agent/memory");
}

/** `POST /api/beta-access/request` (HEL-704) -- no request body; `204 No Content` on success.
 *  Rejects (axios throws) on any non-2xx status, including the `503`/`429`/`409` degradation
 *  cases the caller inspects via `extractErrorMessage`. */
export async function requestBetaAccess(): Promise<void> {
  await httpClient.post("/api/beta-access/request");
}

/** `POST /api/beta-access/redeem` (HEL-704) -- returns the caller's updated `User` (now
 *  `tier: "beta"`) on success, the SAME shape `GET /api/auth/me`/login/register return. */
export async function redeemInviteCode(code: string): Promise<User> {
  const response = await httpClient.post<User>("/api/beta-access/redeem", { code });
  return response.data;
}
