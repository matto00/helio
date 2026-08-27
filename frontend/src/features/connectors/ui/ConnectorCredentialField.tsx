// HEL-824 design.md Decision 3: the auth-type selector + credential input,
// shared verbatim between the create flow and the "Replace credential"
// rotation flow — built as a standalone, page-agnostic component (no
// `/connectors`-specific coupling) so HEL-829's in-chat credential capture
// can mount it directly rather than extracting it retroactively later.

import { FormField, Select, TextField } from "../../../shared/ui/index";
import type { ApiKeyPlacement, ConnectorAuthType } from "../types/connector";
import "./ConnectorCredentialField.css";

const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "No auth" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key", label: "API key" },
];

const PLACEMENT_OPTIONS = [
  { value: "header", label: "Header" },
  { value: "query", label: "Query parameter" },
];

export interface ConnectorCredentialFieldValue {
  authType: ConnectorAuthType;
  credential: string;
  apiKeyName: string;
  apiKeyPlacement: ApiKeyPlacement;
}

export function emptyConnectorCredentialFieldValue(): ConnectorCredentialFieldValue {
  return { authType: "none", credential: "", apiKeyName: "", apiKeyPlacement: "header" };
}

interface ConnectorCredentialFieldProps {
  value: ConnectorCredentialFieldValue;
  onChange: (value: ConnectorCredentialFieldValue) => void;
  /** "create": first-time credential entry (shown-once, mirrors
   *  `ApiTokensSection`'s reveal pattern for the value the user just typed).
   *  "rotate": replacing an existing credential — the copy makes the
   *  irreversibility explicit (design.md Decision 1's "old credential is
   *  deleted, not retired-in-place"). */
  mode: "create" | "rotate";
  idPrefix: string;
  disabled?: boolean;
}

/** Renders the connector-kind-agnostic auth-type selector + credential input.
 *  REST is the only kind at launch, but nothing here hardcodes that — the
 *  auth vocabulary (`none`/`bearer`/`api_key` + header-or-query placement)
 *  mirrors the existing `RestApiAuth` union. */
export function ConnectorCredentialField({
  value,
  onChange,
  mode,
  idPrefix,
  disabled,
}: ConnectorCredentialFieldProps) {
  // HEL-824 skeptic-final-1.md non-blocking suggestion: distinct label
  // strings per mode instead of `.toLowerCase()`-ing an acronym label
  // ("API key value" -> "api key value" reads as a typo, not a lowered
  // sentence).
  const credentialLabel = value.authType === "api_key" ? "API key value" : "Bearer token value";
  const newCredentialLabel =
    value.authType === "api_key" ? "New API key value" : "New bearer token value";
  const credentialRequired = value.authType !== "none";

  // Rotation replaces the credential value only (design.md Decision 1) — the
  // auth type/placement were already set at creation and can't be changed
  // through this action, so the selector is fixed rather than editable.
  const authTypeEditable = mode === "create";

  return (
    <div className="connector-credential-field">
      <FormField label="Authentication" htmlFor={`${idPrefix}-auth-type`}>
        {authTypeEditable ? (
          <Select
            value={value.authType}
            options={AUTH_TYPE_OPTIONS}
            onChange={(authType) => onChange({ ...value, authType: authType as ConnectorAuthType })}
            ariaLabel="Authentication type"
            disabled={disabled}
          />
        ) : (
          <TextField
            id={`${idPrefix}-auth-type`}
            value={
              AUTH_TYPE_OPTIONS.find((o) => o.value === value.authType)?.label ?? value.authType
            }
            readOnly
            disabled
          />
        )}
      </FormField>

      {authTypeEditable && value.authType === "api_key" && (
        <>
          <FormField label="API key parameter name" htmlFor={`${idPrefix}-api-key-name`}>
            <TextField
              id={`${idPrefix}-api-key-name`}
              value={value.apiKeyName}
              onChange={(e) => onChange({ ...value, apiKeyName: e.target.value })}
              placeholder="e.g. X-Api-Key"
              disabled={disabled}
            />
          </FormField>
          <FormField label="Sent as" htmlFor={`${idPrefix}-api-key-placement`}>
            <Select
              value={value.apiKeyPlacement}
              options={PLACEMENT_OPTIONS}
              onChange={(placement) =>
                onChange({ ...value, apiKeyPlacement: placement as ApiKeyPlacement })
              }
              ariaLabel="API key placement"
              disabled={disabled}
            />
          </FormField>
        </>
      )}

      {credentialRequired && (
        <FormField
          label={mode === "rotate" ? newCredentialLabel : credentialLabel}
          htmlFor={`${idPrefix}-credential`}
          hint={
            mode === "rotate"
              ? "The old credential is permanently deleted once this is saved — this cannot be undone."
              : // HEL-824 skeptic-final-1.md non-blocking suggestion: this is a
                // type="password" input, so "shown once" is inaccurate -- it is
                // never shown/displayed at all, only entered.
                "Entered once. It won't be displayed again after saving."
          }
        >
          <TextField
            id={`${idPrefix}-credential`}
            type="password"
            mono
            value={value.credential}
            onChange={(e) => onChange({ ...value, credential: e.target.value })}
            autoComplete="off"
            disabled={disabled}
          />
        </FormField>
      )}
    </div>
  );
}
