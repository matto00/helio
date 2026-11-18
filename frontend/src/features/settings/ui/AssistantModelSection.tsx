import { useEffect, useId, useState } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { FormField } from "../../../shared/ui/FormField";
import { Select, type SelectOption } from "../../../shared/ui/Select";
import { SERVER_DEFAULT_VALUE, serverDefaultLabel } from "../../assistant/modelOptions";
import { fetchAssistantModels } from "../../assistant/state/assistantModelsSlice";
import { saveAssistantModelPreference } from "../state/saveAssistantModelPreference";
import "./AssistantModelSection.css";

/** Settings → Assistant (HEL-1755 D10), owner/beta only: the default model for new assistant conversations. A shared
 *  `Select` in a `FormField`; "Server default" clears the saved choice. Applies immediately, like Appearance. */
export function AssistantModelSection() {
  const dispatch = useAppDispatch();
  const tier = useAppSelector((state) => state.auth.currentUser?.tier);
  const saved = useAppSelector((state) => state.auth.currentUser?.preferences?.assistantModel);
  const models = useAppSelector((state) => state.assistantModels.data);
  const status = useAppSelector((state) => state.assistantModels.status);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const hintId = useId();
  const errorId = useId();

  const entitled = tier === "owner" || tier === "beta";

  useEffect(() => {
    if (status === "idle" && entitled) void dispatch(fetchAssistantModels());
  }, [dispatch, status, entitled]);

  if (!entitled) return null;

  const options: SelectOption[] =
    models === null
      ? []
      : [
          { value: SERVER_DEFAULT_VALUE, label: serverDefaultLabel(models.serverDefault) },
          ...models.models.map((m) => ({ value: m.id, label: m.label })),
        ];
  // A saved id that is no longer selectable reads as unset (the server drops it too).
  const value =
    saved !== undefined && models?.models.some((m) => m.id === saved)
      ? saved
      : SERVER_DEFAULT_VALUE;

  async function onChange(next: string) {
    setError(null);
    const ok = await dispatch(
      saveAssistantModelPreference(next === SERVER_DEFAULT_VALUE ? null : next),
    );
    if (!ok) setError("Failed to save your default model.");
  }

  return (
    <section className="settings-page__section" aria-labelledby="assistant-model-heading">
      <h2 id="assistant-model-heading" className="settings-page__section-heading">
        Assistant
      </h2>
      <div className="assistant-model-section">
        <FormField
          label="Default model"
          htmlFor={selectId}
          error={error}
          errorId={errorId}
          hint="Used for new conversations. You can still change the model in the chat composer."
          hintId={hintId}
        >
          <Select
            id={selectId}
            value={value}
            options={options}
            onChange={(next) => void onChange(next)}
            disabled={models === null}
            ariaInvalid={error !== null}
            ariaDescribedBy={error !== null ? errorId : hintId}
          />
        </FormField>
      </div>
    </section>
  );
}
