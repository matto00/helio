import { type FormEvent, useEffect, useState } from "react";

import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import {
  grantPipelinePermission,
  listPipelinePermissions,
  revokePipelinePermission,
} from "../services/pipelineService";
import type { GrantRole, PermissionGrant } from "../types/pipelineStep";

import "./PipelineShareDialog.css";

interface Props {
  pipelineId: string;
  pipelineName: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Modal dialog allowing the pipeline owner to manage sharing grants.
 *
 * Shows the current grantee list (with role and revoke action), and
 * an "Add grantee" form with user-id input + role selector.
 *
 * API calls: GET/POST/DELETE /api/pipelines/:id/permissions
 */
export function PipelineShareDialog({ pipelineId, pipelineName, open, onClose }: Props) {
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [granteeId, setGranteeId] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listPipelinePermissions(pipelineId)
      .then((items) => {
        setGrants(items);
      })
      .catch(() => {
        setError("Failed to load sharing grants.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, pipelineId]);

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    if (!granteeId.trim()) {
      setAddError("User ID is required.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await grantPipelinePermission(pipelineId, granteeId.trim(), role);
      setGrants((prev) => [...prev, created]);
      setGranteeId("");
      setRole("viewer");
    } catch {
      setAddError("Failed to grant access. The user may already have a grant.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRevoke(grantee: string) {
    try {
      await revokePipelinePermission(pipelineId, grantee);
      setGrants((prev) => prev.filter((g) => g.granteeId !== grantee));
    } catch {
      setError("Failed to revoke access.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share "${pipelineName}"`}
      description="Grant collaborators viewer or editor access to this pipeline."
      size="md"
      ariaLabel={`Share pipeline ${pipelineName}`}
      footer={
        <button type="button" className="pipeline-share-dialog__close-btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="pipeline-share-dialog">
        {/* ── Existing grants list ── */}
        <section className="pipeline-share-dialog__section">
          <h3 className="pipeline-share-dialog__section-title eyebrow">Current access</h3>
          {loading && (
            <p className="pipeline-share-dialog__loading" aria-label="Loading grants">
              Loading…
            </p>
          )}
          {error && (
            <p className="pipeline-share-dialog__error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && grants.length === 0 && (
            <p className="pipeline-share-dialog__empty">No grants yet.</p>
          )}
          {!loading && grants.length > 0 && (
            <ul className="pipeline-share-dialog__grant-list" aria-label="Grantees">
              {grants.map((g) => (
                <li key={g.granteeId} className="pipeline-share-dialog__grant-row">
                  <span className="pipeline-share-dialog__grantee">{g.granteeId}</span>
                  <span className="pipeline-share-dialog__role">{g.role}</span>
                  <button
                    type="button"
                    className="pipeline-share-dialog__revoke-btn"
                    aria-label={`Revoke access for ${g.granteeId}`}
                    onClick={() => g.granteeId != null && void handleRevoke(g.granteeId)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Add grantee form ── */}
        <section className="pipeline-share-dialog__section">
          <h3 className="pipeline-share-dialog__section-title eyebrow">Grant access</h3>
          {addError && (
            <p className="pipeline-share-dialog__error" role="alert">
              {addError}
            </p>
          )}
          <form className="pipeline-share-dialog__add-form" onSubmit={(e) => void handleGrant(e)}>
            <input
              className="pipeline-share-dialog__input"
              type="text"
              placeholder="User ID"
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              aria-label="Grantee user ID"
              disabled={adding}
            />
            <Select
              value={role}
              onChange={(v) => setRole(v as GrantRole)}
              ariaLabel="Grant role"
              disabled={adding}
              options={[
                { value: "viewer", label: "Viewer" },
                { value: "editor", label: "Editor" },
              ]}
            />
            <button
              type="submit"
              className="pipeline-share-dialog__add-btn"
              disabled={adding || !granteeId.trim()}
            >
              {adding ? "Granting…" : "Grant access"}
            </button>
          </form>
        </section>
      </div>
    </Modal>
  );
}
