import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import "../../features/dashboards/ui/DashboardList.css";
import { ActionsMenu } from "./ActionsMenu";
import { EmptyState } from "../ui/EmptyState";
import { TextField } from "../ui/TextField";

export interface SidebarItem {
  id: string;
  name: string;
  /** Optional secondary line rendered under the name (e.g. the Type Registry's
   * "Pipeline: <name>" provenance). Registry-specific — other sections that
   * reuse this component leave it unset and render name-only. The list filter
   * matches on `name` only, never the subtitle. */
  subtitle?: string;
}

interface SidebarItemListProps {
  heading: string;
  items: SidebarItem[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error?: string | null;
  /** Build the route to navigate to for a given item. Provide this OR `onSelect`,
   * not both — `onSelect` takes precedence when both are set. */
  toHref?: (item: SidebarItem) => string;
  /** Dispatch a local selection (e.g. Redux setSelectedSourceId) instead of
   * navigating to a route. Renders item rows as buttons so the URL stays put. */
  onSelect?: (item: SidebarItem) => void;
  /** Id of the currently-active item — drives the highlight and active-dot. */
  activeId?: string | null;
  /** Optional placeholder when the list is empty and not loading. */
  emptyText?: string;
  /** FontAwesome icon to show in the sidebar empty-state hero. */
  emptyIcon?: IconDefinition;
  /** Secondary description shown below the title in the sidebar empty-state. */
  emptyDescription?: string;
  /** If provided, renders a "+" button in the header that triggers onAdd. */
  onAdd?: () => void;
  /** Accessible label for the "+" button (defaults to "Add <heading>"). */
  addLabel?: string;
  /** If provided, an ellipsis menu is rendered per row with a Delete action.
   * Selecting Delete swaps the row for an inline Confirm/Cancel pair *below*
   * the item so confirmation buttons don't get squeezed beside narrow rows. */
  onDelete?: (item: SidebarItem) => void | Promise<void>;
  /** Optional dependency warning shown (as an alert) above the Confirm/Cancel
   * pair while a delete is pending confirmation. Return `null` for no warning. */
  deleteWarning?: (item: SidebarItem) => string | null;
  /** Optional per-item badge rendered inline next to the item's name (e.g. the
   * Type Registry's unstructured-type indicator). Registry-specific — other
   * sections that reuse this component should leave it unset. */
  renderBadge?: (item: SidebarItem) => ReactNode;
  /** Optional per-row action rendered as a SIBLING of the row's own
   * selectable button/link — the same position `ActionsMenu` renders in,
   * just gated on this prop instead of `onDelete` (e.g. the chat section's
   * pin/unpin toggle, HEL-664 design.md D3). A genuine sibling element, not
   * nested inside the row's own `<button>`: unlike `renderBadge` (which
   * renders *inside* that button), a clickable control here needs no
   * `stopPropagation()` to keep its click from also firing `onSelect`.
   * Additive and backward-compatible — existing callers that don't pass it
   * are unaffected. The second `helpers` argument is likewise additive
   * (HEL-693 design.md D2): existing single-argument callers compile and
   * behave unchanged; a caller that wants inline rename (see `onRename`
   * below) wires a row action's `onClick` to `helpers.startRename()`. */
  renderRowAction?: (item: SidebarItem, helpers: { startRename: () => void }) => ReactNode;
  /** Opt-in inline rename (HEL-693 design.md D2). When provided, the row that
   * `helpers.startRename()` (see `renderRowAction`) was called for swaps into
   * an editable text input pre-filled with the current name — a full-row
   * swap, not a squeezed-in confirm panel (design.md D3). Enter commits the
   * trimmed value by calling this with the new name; Escape and blur cancel
   * without calling it. A trimmed value identical to `item.name` also cancels
   * without calling it (design.md D4 — a no-op rename should not touch
   * `updatedAt`). While the returned promise is pending the input is
   * disabled; on resolve the row exits edit mode; on reject it stays in edit
   * mode and shows the rejection's message as a `role="alert"` line below the
   * row (design.md D5) — callers should reject with a human-readable message
   * (e.g. `dispatch(thunk(...)).unwrap()`, which rejects with the thunk's
   * `rejectValue`). */
  onRename?: (item: SidebarItem, name: string) => Promise<void>;
}

// F-187: `heading` is a display string ("Data Types", "Data Pipelines") and can contain spaces —
// used raw, the filter input's `id` wasn't a valid HTML id token.
function slugifyHeading(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function SidebarItemList({
  heading,
  items,
  status,
  error,
  toHref,
  onSelect,
  activeId,
  emptyText,
  emptyIcon,
  emptyDescription,
  onAdd,
  addLabel,
  onDelete,
  deleteWarning,
  renderBadge,
  renderRowAction,
  onRename,
}: SidebarItemListProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameInvalid, setRenameInvalid] = useState(false);
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = filterQuery.toLowerCase().trim();
  const filtered =
    normalizedQuery.length === 0
      ? items
      : items.filter((item) => item.name.toLowerCase().includes(normalizedQuery));

  // Auto-focus + select-all on entering edit mode (design.md D3), and again
  // after a failed save re-enables the input (evaluator Change Request 1,
  // HEL-693 cycle 2): a failed save keeps the same `renamingId` but flips
  // `renameStatus` back to "idle", so `renameStatus` is a dependency too —
  // otherwise a keyboard-only user is stranded on `<body>` with no way to
  // Escape/retype without a mouse. Deliberately an effect rather than a
  // direct `.focus()` call in `commitRename`'s catch block: React batches
  // `setRenameStatus`, so the DOM element is still `disabled` (unfocusable)
  // at the point that call would run — an effect is guaranteed to run only
  // after React has committed the re-enabled input.
  //
  // `{ preventScroll: true }` (skeptic Change Request 1, final-gate round 1):
  // the row being renamed was just clicked, so it's already the vertically
  // in-view row — the only reason `.focus()` would trigger a scroll here is
  // the horizontal overflow the `DashboardList.css` grid-track fix (see that
  // file's `.dashboard-list__items` comment) now resolves at the root. This
  // is defense-in-depth on top of that CSS fix, not a replacement for it:
  // it stops the browser's default "scroll the focus target into view"
  // behavior outright, so even an edge case the width fix doesn't fully
  // anticipate can no longer scroll the input's end into view and hide its
  // start from the user.
  useEffect(() => {
    if (renamingId !== null && renameStatus === "idle") {
      renameInputRef.current?.focus({ preventScroll: true });
      renameInputRef.current?.select();
    }
  }, [renamingId, renameStatus]);

  function startRename(item: SidebarItem) {
    setConfirmDeleteId(null);
    setRenamingId(item.id);
    setRenameValue(item.name);
    setRenameInvalid(false);
    setRenameStatus("idle");
    setRenameError(null);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameInvalid(false);
    setRenameStatus("idle");
    setRenameError(null);
  }

  async function commitRename(item: SidebarItem) {
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      // Blank-after-trim never saves (design.md D4) — stay in edit mode so
      // the user can fix it or Escape out.
      setRenameInvalid(true);
      return;
    }
    if (trimmed === item.name) {
      // No-op rename — exit without a PATCH (design.md D4).
      cancelRename();
      return;
    }
    setRenameStatus("saving");
    setRenameError(null);
    try {
      await onRename?.(item, trimmed);
      cancelRename();
    } catch (err) {
      setRenameStatus("idle");
      // RTK's `dispatch(thunk(...)).unwrap()` (the documented `onRename` shape, design.md D5)
      // throws the thunk's string `rejectValue` directly, not an `Error` — so a plain string
      // must be checked first or the server's message is silently dropped in favor of the
      // generic fallback below.
      setRenameError(
        typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to rename.",
      );
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, item: SidebarItem) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function renderEmpty() {
    if (normalizedQuery.length > 0) {
      return <p className="dashboard-list__status">No matches</p>;
    }
    if (emptyIcon !== undefined) {
      return (
        <EmptyState
          variant="sidebar"
          icon={emptyIcon}
          title={emptyText ?? `No ${heading.toLowerCase()} yet`}
          description={emptyDescription ?? ""}
          cta={
            onAdd !== undefined
              ? {
                  label: addLabel ?? `Add ${heading.toLowerCase().replace(/s$/, "")}`,
                  onClick: onAdd,
                }
              : undefined
          }
        />
      );
    }
    return (
      <p className="dashboard-list__status">{emptyText ?? `No ${heading.toLowerCase()} yet`}</p>
    );
  }

  return (
    <section className="dashboard-list" aria-label={heading.toLowerCase()}>
      <header className="dashboard-list__header">
        <h2>{heading}</h2>
        {onAdd !== undefined ? (
          <div className="dashboard-list__header-actions">
            <button
              type="button"
              className="dashboard-list__add"
              aria-label={addLabel ?? `Add ${heading.toLowerCase().replace(/s$/, "")}`}
              onClick={onAdd}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        ) : null}
      </header>
      <div className="dashboard-list__filter">
        <div className="dashboard-list__filter-wrapper">
          <TextField
            id={`sidebar-filter-${slugifyHeading(heading)}`}
            className="dashboard-list__filter-input"
            type="text"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Search..."
            aria-label={`Filter ${heading.toLowerCase()} by name`}
          />
          {filterQuery.length > 0 ? (
            <button
              type="button"
              className="dashboard-list__filter-clear"
              aria-label="Clear filter"
              onClick={() => setFilterQuery("")}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : null}
        </div>
      </div>
      {status === "loading" ? (
        <p className="dashboard-list__status">Loading {heading.toLowerCase()}…</p>
      ) : error ? (
        <p className="dashboard-list__status" role="alert">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        renderEmpty()
      ) : (
        <ul className="dashboard-list__items">
          {filtered.map((item) => {
            const isActive = item.id === activeId;
            const className = isActive
              ? "dashboard-list__button dashboard-list__button--active"
              : "dashboard-list__button";
            const activeLabel = heading.toLowerCase().replace(/s$/, "");
            const isConfirmingDelete = confirmDeleteId === item.id;
            const isRenaming = renamingId === item.id;
            return (
              <li key={item.id} className="dashboard-list__item dashboard-list__item--row">
                <div className="dashboard-list__item-row">
                  {isRenaming ? (
                    // Full-row swap (design.md D3) — the selectable button/NavLink and row
                    // actions are replaced, not squeezed alongside, while renaming.
                    <div className="dashboard-list__row-rename">
                      <TextField
                        ref={renameInputRef}
                        className="dashboard-list__row-rename-input"
                        type="text"
                        value={renameValue}
                        disabled={renameStatus === "saving"}
                        aria-label={`Rename ${item.name}`}
                        aria-invalid={renameInvalid ? true : undefined}
                        onChange={(event) => {
                          setRenameValue(event.target.value);
                          setRenameInvalid(false);
                        }}
                        onKeyDown={(event) => handleRenameKeyDown(event, item)}
                        onBlur={() => {
                          // Disabling the input while a save is in flight blurs it (a disabled
                          // element can't hold focus) — that's not a user-initiated blur, so it
                          // must not cancel the in-flight rename (design.md D5).
                          if (renameStatus === "saving") return;
                          cancelRename();
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      {onSelect !== undefined ? (
                        <button
                          type="button"
                          className={
                            item.subtitle !== undefined
                              ? `${className} dashboard-list__button--stacked`
                              : className
                          }
                          aria-pressed={isActive}
                          onClick={() => onSelect(item)}
                        >
                          {renderItemText(item, renderBadge)}
                          {isActive ? (
                            <span
                              className="dashboard-list__active-dot"
                              aria-label={`Active ${activeLabel}`}
                            />
                          ) : null}
                        </button>
                      ) : toHref !== undefined ? (
                        <NavLink
                          to={toHref(item)}
                          className={({ isActive: routeActive }) => {
                            const base =
                              routeActive || isActive ? className : "dashboard-list__button";
                            return item.subtitle !== undefined
                              ? `${base} dashboard-list__button--stacked`
                              : base;
                          }}
                          end
                        >
                          {renderItemText(item, renderBadge)}
                          {isActive ? (
                            <span
                              className="dashboard-list__active-dot"
                              aria-label={`Active ${activeLabel}`}
                            />
                          ) : null}
                        </NavLink>
                      ) : null}
                      {renderRowAction !== undefined ? (
                        <span className="dashboard-list__row-action">
                          {renderRowAction(item, { startRename: () => startRename(item) })}
                        </span>
                      ) : null}
                      {onDelete !== undefined && !isConfirmingDelete ? (
                        <ActionsMenu
                          label={`${item.name} actions`}
                          items={[
                            {
                              label: "Delete",
                              onClick: () => setConfirmDeleteId(item.id),
                              danger: true,
                            },
                          ]}
                        />
                      ) : null}
                    </>
                  )}
                </div>
                {isRenaming && renameError !== null ? (
                  <p className="dashboard-list__row-rename-error" role="alert">
                    {renameError}
                  </p>
                ) : null}
                {isConfirmingDelete ? (
                  <div className="dashboard-list__delete-confirm-row">
                    {(() => {
                      const warning = deleteWarning?.(item) ?? null;
                      return warning !== null ? (
                        <p className="dashboard-list__delete-warning" role="alert">
                          {warning}
                        </p>
                      ) : null;
                    })()}
                    <div className="dashboard-list__delete-confirm-actions">
                      <button
                        type="button"
                        className="dashboard-list__delete-confirm-btn"
                        aria-label={`Confirm delete ${item.name}`}
                        onClick={() => {
                          void onDelete?.(item);
                          setConfirmDeleteId(null);
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="dashboard-list__delete-cancel-btn"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Renders a row's name (+ optional badge) and, when set, the provenance
 * subtitle stacked beneath. Shared by the button and NavLink row variants so
 * the two stay identical. When `subtitle` is unset no subtitle element is
 * emitted, keeping other sections' markup unchanged. */
function renderItemText(item: SidebarItem, renderBadge?: (item: SidebarItem) => ReactNode) {
  return (
    <span className="dashboard-list__text">
      <span className="dashboard-list__name-group">
        <span className="dashboard-list__name" title={item.name}>
          {item.name}
        </span>
        {renderBadge?.(item)}
      </span>
      {item.subtitle !== undefined ? (
        <span className="dashboard-list__subtitle">{item.subtitle}</span>
      ) : null}
    </span>
  );
}
