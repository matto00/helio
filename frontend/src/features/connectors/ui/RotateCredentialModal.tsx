// HEL-824 task 4.6: rotate flow — reuses `ConnectorCredentialField` in
// "rotate" mode, explicit irreversibility copy, submits
// `PUT /api/connectors/:id/credential`, returns to the masked-placeholder
// state (the EditConnectorModal it's opened from) on success.

import { useState, type FormEvent } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import { Modal } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { rotateConnectorCredential } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import {
  ConnectorCredentialField,
  emptyConnectorCredentialFieldValue,
} from "./ConnectorCredentialField";

interface RotateCredentialModalProps {
  connector: Connector;
  onClose: () => void;
}

export function RotateCredentialModal({ connector, onClose }: RotateCredentialModalProps) {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();

  const [value, setValue] = useState({
    ...emptyConnectorCredentialFieldValue(),
    authType: connector.config.authType,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.credential.trim() === "") {
      setError("A new credential value is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const result = await dispatch(
      rotateConnectorCredential({ id: connector.id, request: { credential: value.credential } }),
    );
    setIsSubmitting(false);

    if (rotateConnectorCredential.fulfilled.match(result)) {
      pushToast({ variant: "success", message: `Credential rotated for "${connector.name}".` });
      onClose();
    } else {
      setError(result.payload ?? "Failed to rotate credential.");
    }
  }

  return (
    <Modal
      title={`Replace credential for ${connector.name}`}
      // HEL-824 skeptic-final-1.md non-blocking suggestion: the
      // irreversibility warning used to appear here AND again in
      // `ConnectorCredentialField`'s own hint below the credential input --
      // trimmed to state it once. This description now covers the
      // "automatically picked up by dependents" point the field-level hint
      // doesn't; the field-level hint (rotate mode) keeps the
      // irreversibility statement, since it's the more contextually
      // relevant of the two locations (right next to the input the user is
      // about to submit).
      description="Dependent sources pick up the new value automatically once this is saved."
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="connectors-page__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="rotate-credential-form"
            className="connectors-page__btn connectors-page__btn--primary"
            disabled={isSubmitting || value.credential.trim() === ""}
          >
            {isSubmitting ? "Replacing…" : "Replace credential"}
          </button>
        </>
      }
    >
      <form id="rotate-credential-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <ConnectorCredentialField
          value={value}
          onChange={setValue}
          mode="rotate"
          idPrefix="rotate-connector"
        />
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
