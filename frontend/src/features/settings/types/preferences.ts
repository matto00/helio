// HEL-525 (420-D) -- mirrors the backend's `AgentPreferencesResponse` /
// `PutAgentPreferencesRequest` (`AgentPreferencesProtocol.scala`, HEL-472 /
// 420-A) field-for-field. `defaultSeriesColors`/`defaultPanelStyle`/
// `namingConventions` are `Option[...]` on the wire; `settingsService.ts`
// normalizes an absent (spray-json omits `None`) field to `null` at the
// service boundary so this declared `| null` type stays accurate to what
// callers actually receive (mirrors `pipelineService.ts`'s
// `normalizeSchedule` precedent). `defaultPanelStyle`/`namingConventions` are
// genuinely unconstrained JSON objects (`schemas/agent-memory/agent-preferences.schema.json`)
// -- `Record<string, unknown>`, never `any` (design.md Decision 2).

export interface AgentPreferences {
  defaultSeriesColors: string[] | null;
  defaultPanelStyle: Record<string, unknown> | null;
  namingConventions: Record<string, unknown> | null;
  extras: Record<string, unknown>;
}

/** `PUT /api/preferences` body -- a full replace (design.md Decision 4): the
 *  backend clears any field omitted/`None` on a `PUT`. `settingsSlice.ts`'s
 *  `savePreferences` thunk always sends the full, merged object for every
 *  field (never relies on omission), but the type mirrors the backend's
 *  `Option`-shaped request field-for-field. */
export interface PutAgentPreferencesRequest {
  defaultSeriesColors: string[] | null;
  defaultPanelStyle: Record<string, unknown> | null;
  namingConventions: Record<string, unknown> | null;
  extras: Record<string, unknown> | null;
}
