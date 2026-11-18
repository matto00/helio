import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { InlineError } from "../../../shared/chrome/InlineError";
import { Select } from "../../../shared/ui/Select";
import { composerPickerModel, SERVER_DEFAULT_VALUE } from "../modelOptions";
import { setConversationModel, setPendingModel } from "../state/assistantConversationsSlice";
import { fetchAssistantModels } from "../state/assistantModelsSlice";
import "./ModelPicker.css";

interface ModelPickerProps {
  /** The conversation the next send goes to, or `null` when none exists yet. */
  conversationId: string | null;
  /** Disabled while a send is in flight (the model is fixed for the whole request). */
  disabled?: boolean;
}

/** The composer's model picker (HEL-1755 D10), the shared `Select`. Its value is the server-resolved
 *  `effectiveModel` of the open conversation (never derived here); with no conversation it is `defaultModel` until the
 *  user picks, and that pick is held in the slice and sent as `model` on the first converse. Picking on an existing
 *  conversation PATCHes it (optimistic, reverted on error). Renders nothing until the model list has loaded, so a
 *  failed list fetch never blocks sending. */
export function ModelPicker({ conversationId, disabled = false }: ModelPickerProps) {
  const dispatch = useAppDispatch();
  const models = useAppSelector((state) => state.assistantModels.data);
  const modelsStatus = useAppSelector((state) => state.assistantModels.status);
  const active = useAppSelector((state) => state.assistantConversations.activeConversation.data);
  const pendingModel = useAppSelector((state) => state.assistantConversations.pendingModel);
  const modelError = useAppSelector((state) => state.assistantConversations.modelError);

  useEffect(() => {
    if (modelsStatus === "idle") void dispatch(fetchAssistantModels());
  }, [dispatch, modelsStatus]);

  if (models === null) return null;

  const activeForThis = conversationId !== null && active?.id === conversationId ? active : null;
  // An open conversation whose detail has not arrived yet has no effective model to show: disable, never guess.
  const loadingDetail = conversationId !== null && activeForThis === null;
  const effectiveId =
    conversationId === null
      ? (pendingModel ?? models.defaultModel.id)
      : (activeForThis?.effectiveModel ?? models.defaultModel.id);
  const { value, options } = composerPickerModel(models, effectiveId);

  function onChange(next: string) {
    if (conversationId === null) {
      dispatch(setPendingModel(next === SERVER_DEFAULT_VALUE ? null : next));
      return;
    }
    if (activeForThis === null) return;
    const clearing = next === SERVER_DEFAULT_VALUE;
    void dispatch(
      setConversationModel({
        id: conversationId,
        model: clearing ? null : next,
        // A clear resolves to defaultModel (the saved default if any, else the server default): no flash-and-flip.
        optimisticEffective: clearing ? (models?.defaultModel.id ?? effectiveId) : next,
        previous: {
          model: activeForThis.model ?? null,
          effectiveModel: activeForThis.effectiveModel ?? effectiveId,
        },
      }),
    );
  }

  return (
    <div className="model-picker">
      <Select
        ariaLabel="Model"
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled || loadingDetail}
      />
      <InlineError error={modelError} />
    </div>
  );
}
