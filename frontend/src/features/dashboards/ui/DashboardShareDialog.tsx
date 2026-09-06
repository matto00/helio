// HEL-590 -- dashboard share-link management dialog: mint a link (optional expiry), show it
// exactly once with copy-to-clipboard, list existing links with Active/Expired/Revoked status,
// and revoke behind ConfirmInline (never `window.confirm`). Structure follows
// `PipelineShareDialog.tsx`; the shown-once-secret handling follows `ApiTokensSection.tsx`
// (design.md D8).

import { type FormEvent, useEffect, useState } from "react";
import { faCopy, faLink } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { pushToast } from "../../toasts/state/toastsSlice";
import {
  createShareTokenThunk,
  dismissCreatedShareToken,
  fetchShareTokens,
  revokeShareTokenThunk,
  selectShareTokensForDashboard,
} from "../state/shareTokensSlice";
import type { ShareTokenResponse } from "../types/shareToken";

import "./DashboardShareDialog.css";

interface Props {
  dashboardId: string;
  dashboardName: string;
  open: boolean;
  onClose: () => void;
}

type TokenState = "active" | "expired" | "revoked";

function tokenState(token: ShareTokenResponse, now: Date): TokenState {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && new Date(token.expiresAt) <= now) return "expired";
  return "active";
}

// HEL-590 evaluation-2.md CR-C: exported so `PublicDashboardViewerPage.routing.test.tsx` can call
// this function directly (stripping `window.location.origin`) rather than re-typing its output as
// an independent literal -- a mutation to this function's path shape now reddens that test, not
// just this component's own literal-comparison test.
export function buildShareUrl(dashboardId: string, token: string): string {
  return `${window.location.origin}/dashboards/${dashboardId}/panels?token=${token}`;
}

export function DashboardShareDialog({ dashboardId, dashboardName, open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const { items, status, error, createStatus, createError, createdToken, revokeError } =
    useAppSelector((state) => selectShareTokensForDashboard(state, dashboardId));

  const [expiresAt, setExpiresAt] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void dispatch(fetchShareTokens(dashboardId));
  }, [open, dashboardId, dispatch]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = expiresAt.trim();
    const isoExpiresAt = trimmed === "" ? undefined : new Date(trimmed).toISOString();
    const result = await dispatch(createShareTokenThunk({ dashboardId, expiresAt: isoExpiresAt }));
    if (createShareTokenThunk.fulfilled.match(result)) {
      setExpiresAt("");
    }
  }

  function handleRevoke(tokenId: string) {
    void dispatch(revokeShareTokenThunk({ dashboardId, tokenId }));
    setConfirmRevokeId(null);
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      dispatch(pushToast({ variant: "success", message: "Share link copied to clipboard." }));
    } catch {
      dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
    }
  }

  const now = new Date();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share "${dashboardName}"`}
      description="Anyone with a valid link can view this dashboard without signing in."
      size="md"
      footer={
        <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="dashboard-share-dialog">
        {createdToken !== null && (
          <div className="dashboard-share-dialog__reveal">
            <p className="dashboard-share-dialog__reveal-hint">
              Copy this link now — it won&rsquo;t be shown again.
            </p>
            <div className="dashboard-share-dialog__reveal-row">
              <TextField
                type="text"
                mono
                readOnly
                value={buildShareUrl(dashboardId, createdToken.token)}
                aria-label="New share link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="dashboard-share-dialog__copy-btn"
                onClick={() => void handleCopy(buildShareUrl(dashboardId, createdToken.token))}
              >
                <FontAwesomeIcon icon={faCopy} aria-hidden="true" />
                Copy
              </button>
            </div>
            <button
              type="button"
              className="dashboard-share-dialog__done-btn"
              onClick={() => dispatch(dismissCreatedShareToken(dashboardId))}
            >
              Done
            </button>
          </div>
        )}

        <form
          className="dashboard-share-dialog__create-form"
          onSubmit={(e) => void handleCreate(e)}
        >
          <label className="dashboard-share-dialog__expiry-label" htmlFor="share-token-expiry">
            Expiry (optional)
          </label>
          <div className="dashboard-share-dialog__create-row">
            <input
              id="share-token-expiry"
              type="datetime-local"
              className="dashboard-share-dialog__expiry-input"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              aria-label="Share link expiry"
            />
            <button
              type="submit"
              className="ui-modal-btn ui-modal-btn--primary dashboard-share-dialog__create-btn"
              disabled={createStatus === "loading"}
            >
              <FontAwesomeIcon icon={faLink} aria-hidden="true" />
              {createStatus === "loading" ? "Creating…" : "Create link"}
            </button>
          </div>
          <InlineError error={createError} />
        </form>

        {status === "loading" && (
          <p className="dashboard-share-dialog__loading" aria-label="Loading share links">
            Loading…
          </p>
        )}
        {status === "failed" && <InlineError error={error} />}

        {status === "succeeded" && items.length === 0 && (
          <EmptyState
            variant="main"
            icon={faLink}
            title="No share links yet"
            description="Create a link to let anyone view this dashboard without signing in."
          />
        )}
        {status === "succeeded" && items.length > 0 && (
          <ul className="dashboard-share-dialog__token-list" aria-label="Share links">
            {items.map((token) => {
              const st = tokenState(token, now);
              const isConfirming = confirmRevokeId === token.id;
              return (
                <li key={token.id} className="dashboard-share-dialog__token-row">
                  <div className="dashboard-share-dialog__token-meta">
                    <StatusChip
                      intent={st === "active" ? "success" : st === "expired" ? "neutral" : "error"}
                    >
                      {st === "active" ? "Active" : st === "expired" ? "Expired" : "Revoked"}
                    </StatusChip>
                    <span className="dashboard-share-dialog__token-created">
                      Created {new Date(token.createdAt).toLocaleString()}
                    </span>
                    <span className="dashboard-share-dialog__token-expiry">
                      {st === "revoked"
                        ? "—"
                        : token.expiresAt === null
                          ? "Never expires"
                          : `Expires ${new Date(token.expiresAt).toLocaleString()}`}
                    </span>
                  </div>
                  {st === "active" &&
                    (isConfirming ? (
                      <ConfirmInline
                        confirmAriaLabel="Confirm revoke share link"
                        onConfirm={() => handleRevoke(token.id)}
                        onCancel={() => setConfirmRevokeId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="dashboard-share-dialog__revoke-btn"
                        aria-label="Revoke share link"
                        onClick={() => setConfirmRevokeId(token.id)}
                      >
                        Revoke
                      </button>
                    ))}
                  <div className="dashboard-share-dialog__row-error">
                    <InlineError error={revokeError[token.id] ?? null} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
