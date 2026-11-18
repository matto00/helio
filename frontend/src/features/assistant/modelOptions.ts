import type { SelectOption } from "../../shared/ui/Select";
import type { AssistantModelRef, AssistantModelsResponse } from "./types";

/** The picker value standing for "no model of ours": the server default is not one of the selectable models, or the
 *  user chose to clear the stored model. Never sent to the server (it maps to `model: null` / no model). */
export const SERVER_DEFAULT_VALUE = "__server_default__";

/** `Server default (<label or id>)` — the one wording shared by the composer and Settings (HEL-1755 D10). */
export function serverDefaultLabel(serverDefault: AssistantModelRef): string {
  return `Server default (${serverDefault.label ?? serverDefault.id})`;
}

/** The catalog label of a model id, else the raw id (the transcript's muted per-answer label). */
export function modelLabelFor(models: AssistantModelsResponse | null, id: string): string {
  return models?.models.find((m) => m.id === id)?.label ?? id;
}

export interface ComposerPickerModel {
  value: string;
  options: SelectOption[];
}

/** The composer picker's value + options for the model the NEXT turn will use (`effectiveId`).
 *
 *  A "Server default (<id>)" option (it PATCHes `model: null`) exists ONLY when clearing resolves to a model that is not
 *  itself selectable, i.e. `defaultModel` (the caller's resolved default for a new conversation: their saved default if
 *  selectable, else the server default) is not in the list. When `defaultModel` is selectable the option would be a
 *  second spelling of an existing one, and with a saved default it would promise the server default while the server
 *  resolves a clear to the user's default; picking that model explicitly is the honest way to store it. It is also the
 *  shown value when the effective model itself is not selectable. */
export function composerPickerModel(
  models: AssistantModelsResponse,
  effectiveId: string,
): ComposerPickerModel {
  const options: SelectOption[] = models.models.map((m) => ({ value: m.id, label: m.label }));
  const effectiveSelectable = models.models.some((m) => m.id === effectiveId);
  const defaultSelectable = models.models.some((m) => m.id === models.defaultModel.id);
  if (effectiveSelectable && defaultSelectable) return { value: effectiveId, options };
  const resolved = effectiveSelectable ? models.defaultModel : { id: effectiveId };
  return {
    value: effectiveSelectable ? effectiveId : SERVER_DEFAULT_VALUE,
    options: [{ value: SERVER_DEFAULT_VALUE, label: serverDefaultLabel(resolved) }, ...options],
  };
}
