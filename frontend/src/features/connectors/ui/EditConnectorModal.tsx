// HEL-824 task 4.5: edit flow for non-secret fields (name/baseUrl) only.
// The credential field always shows a masked placeholder + "Replace
// credential" action here — never the real or an empty-implying value
// (spec "Credential never reappears after creation"). "Replace credential"
// is hidden for a no-auth Connector (design.md Risks note — there is
// nothing to replace).

import { useState, type FormEvent } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import { FormField, Modal, TextField } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { updateConnector } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import { RotateCredentialModal } from "./RotateCredentialModal";

interface EditConnectorModalProps {
  connector: Connector;
  onClose: () => void;
}

export function EditConnectorModal({ connector, onClose }: EditConnectorModalProps) {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();

  const [name, setName] = useState(connector.name);
  const [baseUrl, setBaseUrl] = useState(connector.baseUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const authType = connector.config.authType;
  const canRotate = authType !== "none";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "" || baseUrl.trim() === "") return;

    setIsSubmitting(true);
    setError(null);
    const result = await dispatch(
      updateConnector({
        id: connector.id,
        request: { name: name.trim(), baseUrl: baseUrl.trim() },
      }),
    );
    setIsSubmitting(false);

    if (updateConnector.fulfilled.match(result)) {
      pushToast({ variant: "success", message: `Connector "${result.payload.name}" updated.` });
      onClose();
    } else {
      setError(result.payload ?? "Failed to update connector.");
    }
  }

  if (rotating) {
    return <RotateCredentialModal connector={connector} onClose={() => setRotating(false)} />;
  }

  return (
    <Modal
      title={`Edit ${connector.name}`}
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="connectors-page__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-connector-form"
            className="connectors-page__btn connectors-page__btn--primary"
            disabled={isSubmitting || name.trim() === "" || baseUrl.trim() === ""}
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-connector-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <FormField label="Name" htmlFor="edit-connector-name">
          <TextField
            id="edit-connector-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Base URL" htmlFor="edit-connector-base-url">
          <TextField
            id="edit-connector-base-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </FormField>
        <FormField
          label="Credential"
          hint={
            canRotate
              ? "The credential is never shown after creation."
              : "This connector has no authentication configured."
          }
        >
          <div className="connectors-page__credential-row">
            <span className="connectors-page__credential-mask" aria-hidden="true">
              ••••••••
            </span>
            {canRotate && (
              <button
                type="button"
                className="connectors-page__btn connectors-page__btn--secondary"
                onClick={() => setRotating(true)}
              >
                Replace credential
              </button>
            )}
          </div>
        </FormField>
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
