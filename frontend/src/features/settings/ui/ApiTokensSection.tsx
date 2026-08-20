// Personal access tokens Settings section (HEL-727): create a named PAT
// (shown once), list existing tokens (name/created/last-used), revoke —
// mirrors `AgentMemoryList.tsx`'s list/per-row-`ConfirmInline` shape and
// `MfaSecuritySection.tsx`'s shown-once-reveal + clipboard-copy + blank-guard
// precedents (design.md). Fetch-on-mount lives in `SettingsPage.tsx`
// (F-047's own-loading/error-gate pattern, matching Preferences/Agent
// memory); this component receives the fetched `tokens` as a prop and owns
// only the create/revoke/reveal interaction state.

import { type FormEvent, useState } from "react";
import { faCopy, faKey } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { InlineError } from "../../../shared/chrome/InlineError";
import { ConfirmInline, EmptyState, FormField, TextField } from "../../../shared/ui/index";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { pushToast } from "../../toasts/state/toastsSlice";
import {
  createApiTokenThunk,
  dismissCreatedApiToken,
  revokeApiTokenThunk,
} from "../state/settingsSlice";
import type { ApiTokenResponse } from "../types/apiToken";
import "./ApiTokensSection.css";

function formatLastUsed(lastUsedAt: string | null): string {
  return lastUsedAt === null ? "Never used" : new Date(lastUsedAt).toLocaleString();
}

interface ApiTokensSectionProps {
  tokens: ApiTokenResponse[];
}

export function ApiTokensSection({ tokens }: ApiTokensSectionProps) {
  const dispatch = useAppDispatch();
  const { createStatus, createError, createdToken, revokeError } = useAppSelector(
    (state) => state.settings.apiTokens,
  );
  const [name, setName] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const result = await dispatch(createApiTokenThunk(name.trim()));
    if (createApiTokenThunk.fulfilled.match(result)) {
      setName("");
    }
  }

  function handleRevoke(id: string) {
    void dispatch(revokeApiTokenThunk(id));
    setConfirmRevokeId(null);
  }

  async function handleCopyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      dispatch(pushToast({ variant: "success", message: "Token copied to clipboard." }));
    } catch {
      dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
    }
  }

  return (
    <div className="api-tokens-section">
      {createdToken !== null && (
        <div className="api-tokens-section__reveal">
          <p className="api-tokens-section__reveal-hint">
            Copy this token now — it won&rsquo;t be shown again.
          </p>
          <div className="api-tokens-section__reveal-row">
            <TextField
              type="text"
              mono
              readOnly
              value={createdToken.token}
              aria-label="New personal access token"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="api-tokens-section__copy-btn"
              onClick={() => void handleCopyToken(createdToken.token)}
            >
              <FontAwesomeIcon icon={faCopy} aria-hidden="true" />
              Copy
            </button>
          </div>
          <button
            type="button"
            className="api-tokens-section__done-btn"
            onClick={() => dispatch(dismissCreatedApiToken())}
          >
            Done
          </button>
        </div>
      )}

      <form
        className="api-tokens-section__create-form"
        onSubmit={(e) => void handleCreate(e)}
        noValidate
      >
        <FormField label="Token name" htmlFor="api-token-name">
          <div className="api-tokens-section__create-row">
            <TextField
              id="api-token-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. helio-mcp"
            />
            <button
              type="submit"
              className="api-tokens-section__create-btn"
              disabled={createStatus === "loading" || name.trim() === ""}
            >
              {createStatus === "loading" ? "Creating…" : "Create token"}
            </button>
          </div>
        </FormField>
        <InlineError error={createError} />
      </form>

      {tokens.length === 0 ? (
        <EmptyState
          variant="main"
          icon={faKey}
          title="No personal access tokens yet"
          description="Create a token to let an agent (like helio-mcp) authenticate as you."
        />
      ) : (
        <table className="api-tokens-list-table">
          <thead>
            <tr>
              <th className="api-tokens-list-table__th">Name</th>
              <th className="api-tokens-list-table__th">Created</th>
              <th className="api-tokens-list-table__th">Last used</th>
              <th className="api-tokens-list-table__th api-tokens-list-table__th--actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => {
              const isConfirming = confirmRevokeId === token.id;
              return (
                <tr key={token.id} className="api-tokens-list-table__row">
                  <td className="api-tokens-list-table__td">{token.name}</td>
                  <td className="api-tokens-list-table__td">
                    {new Date(token.createdAt).toLocaleString()}
                  </td>
                  <td className="api-tokens-list-table__td">{formatLastUsed(token.lastUsedAt)}</td>
                  <td className="api-tokens-list-table__td api-tokens-list-table__td--actions">
                    {isConfirming ? (
                      <ConfirmInline
                        confirmAriaLabel={`Confirm revoke ${token.name}`}
                        onConfirm={() => handleRevoke(token.id)}
                        onCancel={() => setConfirmRevokeId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="api-tokens-list-table__revoke-btn"
                        aria-label={`Revoke ${token.name}`}
                        onClick={() => setConfirmRevokeId(token.id)}
                      >
                        Revoke
                      </button>
                    )}
                    <div className="api-tokens-list-table__row-error">
                      <InlineError error={revokeError[token.id] ?? null} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
