// HEL-829 tasks.md 2.1 — the in-chat credential capture form (design.md
// Decision 3), reused verbatim across all three proposal-review pages. Reuses
// `ConnectorCredentialField` directly (HEL-824) — no second credential input.
//
// SECURITY-LOAD-BEARING (design.md Decision 3, Point 7 — the "carrier
// statement"): the credential value lives ONLY in this component's own local
// `useState` for the lifetime of the submit call. It is NEVER written to
// router state, sessionStorage/localStorage, or any Redux slice other than
// the single `createConnector` thunk dispatch below, whose own payload
// carries it directly to `POST /api/connectors`. It is discarded on submit
// resolution (success or failure) by this component's own unmount/removal —
// never held anywhere else, never re-displayed.

import { useState, type FormEvent } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { FormField, TextField } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { createConnector } from "../state/connectorsSlice";
import type { ConnectorConfig } from "../types/connector";
import type { UnresolvedConnectorRef } from "../../proposals/utils/unresolvedConnectorRefs";
import {
  ConnectorCredentialField,
  emptyConnectorCredentialFieldValue,
} from "./ConnectorCredentialField";
import "./InlineConnectorSetup.css";

interface InlineConnectorSetupProps {
  reference: UnresolvedConnectorRef;
  /** Called with the newly created Connector's id on success — the caller
   *  patches its own local proposal copy (design.md Decision 3, Point 5).
   *  This component never touches the proposal itself. */
  onResolved: (connectorId: string) => void;
}

export function InlineConnectorSetup({ reference, onResolved }: InlineConnectorSetupProps) {
  const dispatch = useAppDispatch();
  const draft = reference.draft;

  const [name, setName] = useState(draft?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(draft?.baseUrl ?? "");
  const [credentialValue, setCredentialValue] = useState(() => {
    const initial = emptyConnectorCredentialFieldValue();
    if (!draft) return initial;
    return {
      ...initial,
      authType:
        draft.authType === "bearer" || draft.authType === "api_key" ? draft.authType : "none",
      apiKeyName: draft.apiKeyName ?? "",
      apiKeyPlacement: draft.apiKeyPlacement === "query" ? "query" : "header",
    } as typeof initial;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionLabel = `Set up connector: ${draft?.name ?? reference.danglingConnectorId ?? "unresolved"}`;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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

    // The ONLY place the credential value travels: directly into this one
    // thunk's payload, straight to POST /api/connectors. Never assigned to
    // any other variable, never logged, never passed to any other dispatch.
    const result = await dispatch(
      createConnector({
        name: name.trim(),
        kind: "rest_api",
        baseUrl: baseUrl.trim(),
        config,
        credential: credentialValue.authType === "none" ? "" : credentialValue.credential,
      }),
    );

    setIsSubmitting(false);

    if (createConnector.fulfilled.match(result)) {
      onResolved(result.payload.id);
    } else {
      setError(result.payload ?? "Failed to create connector.");
    }
  }

  return (
    <section className="inline-connector-setup" aria-label={sectionLabel}>
      <p className="eyebrow inline-connector-setup__label">Set up connector</p>
      <p className="inline-connector-setup__name">
        {draft?.name ?? "This connector no longer exists"}
      </p>

      {draft ? (
        <p className="inline-connector-setup__instructions">{draft.retrievalInstructions}</p>
      ) : (
        <p className="inline-connector-setup__instructions">
          A connector this proposal referenced was deleted. Create a replacement below.
        </p>
      )}

      <p className="inline-connector-setup__guarantee">
        Agents never see this key — it is enforced in code: this form submits directly to your
        workspace&rsquo;s encrypted credential store and is never part of the conversation.
      </p>

      <form
        className="inline-connector-setup__form"
        id={`inline-connector-setup-${reference.key}`}
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
      >
        <FormField label="Name" htmlFor={`inline-connector-setup-${reference.key}-name`}>
          <TextField
            id={`inline-connector-setup-${reference.key}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stripe"
          />
        </FormField>
        <FormField label="Base URL" htmlFor={`inline-connector-setup-${reference.key}-base-url`}>
          <TextField
            id={`inline-connector-setup-${reference.key}-base-url`}
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
          idPrefix={`inline-connector-setup-${reference.key}`}
          disabled={isSubmitting}
        />
        <InlineError error={error} />
        <button
          type="submit"
          className="inline-connector-setup__btn inline-connector-setup__btn--primary"
          disabled={isSubmitting || name.trim() === "" || baseUrl.trim() === ""}
        >
          {isSubmitting ? "Creating…" : "Create connector"}
        </button>
      </form>
    </section>
  );
}
