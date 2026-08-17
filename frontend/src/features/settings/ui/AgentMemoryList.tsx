// Agent memory list (HEL-525 / 420-D task 3.3): kind/content/last-used table,
// per-entry delete and list-level "Clear all" — both using this codebase's
// established inline confirm/cancel affordance, mirroring
// `MetricListTable.tsx`'s `confirmDeleteId` state shape exactly. Never
// `window.confirm` (design.md Decision 5).

import { useState } from "react";
import { faBrain } from "@fortawesome/free-solid-svg-icons";

import { InlineError } from "../../../shared/chrome/InlineError";
import { EmptyState } from "../../../shared/ui/index";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { clearAgentMemoryThunk, deleteAgentMemoryEntryThunk } from "../state/settingsSlice";
import type { AgentMemoryEntry } from "../types/agentMemory";
import "./AgentMemoryList.css";

function formatLastUsed(lastUsedAt: string | null): string {
  return lastUsedAt === null ? "Never used" : new Date(lastUsedAt).toLocaleString();
}

/** Keeps per-row delete aria-labels distinguishable (and readable) — entries
 *  have no `name` field to key off of (unlike `MetricListTable.tsx`'s
 *  `metric.name`), so a truncated snippet of `content` stands in for one. */
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

interface AgentMemoryListProps {
  entries: AgentMemoryEntry[];
}

export function AgentMemoryList({ entries }: AgentMemoryListProps) {
  const dispatch = useAppDispatch();
  const clearError = useAppSelector((state) => state.settings.agentMemory.clearError);
  const deleteError = useAppSelector((state) => state.settings.agentMemory.deleteError);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  function handleDelete(id: string) {
    void dispatch(deleteAgentMemoryEntryThunk(id));
    setConfirmDeleteId(null);
  }

  function handleClearAll() {
    void dispatch(clearAgentMemoryThunk());
    setConfirmClearAll(false);
  }

  if (entries.length === 0) {
    // F-151 — the populated state below always renders inside the shared
    // `.agent-memory-list` card (matching Preferences/Beta access's bordered
    // `--app-surface` treatment); the empty state used to bypass that
    // wrapper entirely and float bare on the page canvas, the one case most
    // free/fresh accounts actually see. Keep the same wrapper here so
    // Settings stays internally consistent regardless of whether any memory
    // has been stored yet.
    return (
      <div className="agent-memory-list">
        <EmptyState
          variant="main"
          icon={faBrain}
          title="No memory stored yet"
          description="The agent hasn't stored any facts, goals, or preference notes about you yet."
        />
      </div>
    );
  }

  return (
    <div className="agent-memory-list">
      <div className="agent-memory-list__toolbar">
        {confirmClearAll ? (
          <ConfirmInline
            label={`Clear all ${entries.length} entr${entries.length === 1 ? "y" : "ies"}?`}
            onConfirm={handleClearAll}
            onCancel={() => setConfirmClearAll(false)}
          />
        ) : (
          <button
            type="button"
            className="agent-memory-list__clear-all-btn"
            onClick={() => setConfirmClearAll(true)}
          >
            Clear all
          </button>
        )}
      </div>
      <InlineError error={clearError} />

      <table className="agent-memory-list-table">
        <thead>
          <tr>
            <th className="agent-memory-list-table__th">Kind</th>
            <th className="agent-memory-list-table__th">Content</th>
            <th className="agent-memory-list-table__th">Last used</th>
            <th className="agent-memory-list-table__th agent-memory-list-table__th--actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isConfirming = confirmDeleteId === entry.id;
            const label = truncate(entry.content, 40);
            return (
              <tr key={entry.id} className="agent-memory-list-table__row">
                <td className="agent-memory-list-table__td">
                  <span className="agent-memory-list-table__kind">{entry.kind}</span>
                </td>
                <td className="agent-memory-list-table__td agent-memory-list-table__td--content">
                  {entry.content}
                </td>
                <td className="agent-memory-list-table__td">{formatLastUsed(entry.lastUsedAt)}</td>
                <td className="agent-memory-list-table__td agent-memory-list-table__td--actions">
                  {isConfirming ? (
                    <ConfirmInline
                      confirmAriaLabel={`Confirm delete ${label}`}
                      onConfirm={() => handleDelete(entry.id)}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="agent-memory-list-table__delete-btn"
                      aria-label={`Delete ${label}`}
                      onClick={() => setConfirmDeleteId(entry.id)}
                    >
                      Delete
                    </button>
                  )}
                  {/* A failed delete must never be silent (a stale row can 404
                      on a real race) — `deleteError[entry.id]` is populated by
                      `deleteAgentMemoryEntryThunk.rejected` and outlives the
                      ephemeral confirm/cancel affordance above (which always
                      reverts to the plain Delete button on confirm, success or
                      failure), so the error stays visible until the next
                      delete attempt clears it. Mirrors the `clearError` ->
                      `InlineError` wiring above. */}
                  <div className="agent-memory-list-table__row-error">
                    <InlineError error={deleteError[entry.id] ?? null} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
