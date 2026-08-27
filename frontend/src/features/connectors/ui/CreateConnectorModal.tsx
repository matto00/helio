// HEL-824 task 4.4: create flow — mirrors AddSourceModal's modal pattern.
// No connection-test action here (design.md Decision 3b): a saved Connector
// is required before a test can run.

import { useState, type FormEvent } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import { FormField, Modal, TextField } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { createConnector } from "../state/connectorsSlice";
import type { Connector, ConnectorConfig } from "../types/connector";
import {
  ConnectorCredentialField,
  emptyConnectorCredentialFieldValue,
} from "./ConnectorCredentialField";

interface CreateConnectorModalProps {
  onClose: () => void;
  /** HEL-827: called with the newly created Connector just before `onClose()`
   *  on success — lets a caller (e.g. the REST source form's Connector
   *  picker) select the new Connector without a racy re-read of
   *  `connectorsSlice`. Optional and backwards-compatible: `ConnectorsPage`'s
   *  existing usage passes nothing and is unaffected. */
  onCreated?: (connector: Connector) => void;
}

export function CreateConnectorModal({ onClose, onCreated }: CreateConnectorModalProps) {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialValue, setCredentialValue] = useState(emptyConnectorCredentialFieldValue());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // HEL-827: when this modal is opened from inside another modal's own
    // <form> (e.g. the REST source form's Connector picker), it's rendered
    // via a portal to avoid invalid DOM form-in-form nesting — but React's
    // synthetic event system bubbles by component (React) tree, not DOM
    // tree, so this submit would otherwise still reach the ancestor
    // `<form>`'s own onSubmit handler and fire its validation prematurely
    // (probe: AddSourceModal's "A Connector is required." error appeared
    // immediately on connector creation, before the new Connector was even
    // selected). Stop it here so this modal's submit never leaks to an
    // ancestor form regardless of where it's mounted.
    e.stopPropagation();
    if (name.trim() === "" || baseUrl.trim() === "") return;
    if (credentialValue.authType !== "none" && credentialValue.credential.trim() === "") {
      setError("A credential is required for this authentication type.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const config: ConnectorConfig = {
      authType: credentialValue.authType,
      ...(credentialValue.authType === "api_key"
        ? {
            apiKeyName: credentialValue.apiKeyName,
            apiKeyPlacement: credentialValue.apiKeyPlacement,
          }
        : {}),
    };

    const result = await dispatch(
      createConnector({
        name: name.trim(),
        kind: "rest_api",
        baseUrl: baseUrl.trim(),
        config,
        // HEL-822 CR6: no-auth allows an explicitly-empty credential.
        credential: credentialValue.authType === "none" ? "" : credentialValue.credential,
      }),
    );

    setIsSubmitting(false);

    if (createConnector.fulfilled.match(result)) {
      pushToast({ variant: "success", message: `Connector "${result.payload.name}" created.` });
      onCreated?.(result.payload);
      onClose();
    } else {
      setError(result.payload ?? "Failed to create connector.");
    }
  }

  return (
    <Modal
      title="Add connector"
      description="A saved, reusable credentialed host — the credential is entered once and never shown again."
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="connectors-page__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-connector-form"
            className="connectors-page__btn connectors-page__btn--primary"
            disabled={isSubmitting || name.trim() === "" || baseUrl.trim() === ""}
          >
            {isSubmitting ? "Creating…" : "Create connector"}
          </button>
        </>
      }
    >
      <form id="create-connector-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <FormField label="Name" htmlFor="create-connector-name">
          <TextField
            id="create-connector-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stripe"
            autoFocus
          />
        </FormField>
        <FormField label="Base URL" htmlFor="create-connector-base-url">
          <TextField
            id="create-connector-base-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
          />
        </FormField>
        <ConnectorCredentialField
          value={credentialValue}
          onChange={setCredentialValue}
          mode="create"
          idPrefix="create-connector"
        />
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
