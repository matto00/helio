import { ChevronDown, ChevronRight } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import {
  deleteDashboardFolder,
  renameDashboardFolder,
  setDashboardFolderCollapsed,
} from "../state/dashboardFoldersSlice";
import type { DashboardFolder } from "../types/dashboardFolder";

interface DashboardFolderGroupProps {
  folder: DashboardFolder;
  /** Dashboards in the folder (not narrowed by the filter). */
  count: number;
  /** What is shown: the saved state, or a one-time reveal after navigating into a collapsed folder. */
  expanded: boolean;
  /** Called when the disclosure is used, so a one-time reveal ends and the shown state matches what is saved. */
  onToggle: () => void;
  children: ReactNode;
}

/** One folder in the dashboards context list: a disclosure header (name + mono count), inline rename, delete with
 *  confirm, and its dashboards. Collapsing is saved on the server (optimistic, rolled back on failure). */
export function DashboardFolderGroup({
  folder,
  count,
  expanded,
  onToggle,
  children,
}: DashboardFolderGroupProps) {
  const dispatch = useAppDispatch();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  function startRename() {
    cancelled.current = false;
    setDraftName(folder.name);
    setError(null);
    setRenaming(true);
  }

  async function commitRename() {
    if (cancelled.current) return;
    const trimmed = draftName.trim();
    if (trimmed === folder.name) {
      setRenaming(false);
      return;
    }
    if (trimmed.length === 0) {
      setError("Name must not be blank.");
      return;
    }
    try {
      await dispatch(renameDashboardFolder({ folderId: folder.id, name: trimmed })).unwrap();
      setRenaming(false);
      setError(null);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to rename folder.");
    }
  }

  function onRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void commitRename();
    else if (event.key === "Escape") {
      cancelled.current = true;
      setRenaming(false);
      setError(null);
    }
  }

  async function confirmDelete() {
    try {
      await dispatch(deleteDashboardFolder({ folderId: folder.id })).unwrap();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to delete folder.");
    }
  }

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <section className="dashboard-list__folder" aria-label={`Folder ${folder.name}`}>
      <div className="dashboard-list__folder-header">
        {renaming ? (
          <input
            className="dashboard-list__rename-input"
            type="text"
            value={draftName}
            autoFocus
            aria-label="Folder name"
            onChange={(event) => {
              setDraftName(event.target.value);
              setError(null);
            }}
            onKeyDown={onRenameKeyDown}
            onBlur={() => void commitRename()}
          />
        ) : (
          <button
            type="button"
            className="dashboard-list__folder-toggle"
            aria-expanded={expanded}
            onClick={() => {
              onToggle();
              void dispatch(
                setDashboardFolderCollapsed({ folderId: folder.id, collapsed: expanded }),
              );
            }}
          >
            <Chevron size={ICON_SIZE.sm} aria-hidden="true" />
            <span className="dashboard-list__folder-name">{folder.name}</span>
            <span className="dashboard-list__folder-count">{count}</span>
          </button>
        )}
        {!renaming && !confirmingDelete && (
          <ActionsMenu
            label={`${folder.name} folder actions`}
            items={[
              { label: "Rename folder", onClick: startRename },
              { label: "Delete folder", onClick: () => setConfirmingDelete(true), danger: true },
            ]}
          />
        )}
      </div>
      {confirmingDelete && (
        <div className="dashboard-list__delete-confirm-row">
          <p className="dashboard-list__folder-warning" role="alert">
            Its dashboards are kept and move to Unfiled.
          </p>
          <div className="dashboard-list__delete-confirm-actions">
            <button
              type="button"
              className="dashboard-list__delete-confirm-btn"
              onClick={() => void confirmDelete()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="dashboard-list__delete-cancel-btn"
              onClick={() => {
                setConfirmingDelete(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <InlineError error={error} />
      {expanded && children}
    </section>
  );
}
