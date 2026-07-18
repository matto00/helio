import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import type { ReactNode } from "react";
import { useState } from "react";
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
}: SidebarItemListProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const normalizedQuery = filterQuery.toLowerCase().trim();
  const filtered =
    normalizedQuery.length === 0
      ? items
      : items.filter((item) => item.name.toLowerCase().includes(normalizedQuery));

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
            id={`sidebar-filter-${heading}`}
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
            return (
              <li key={item.id} className="dashboard-list__item dashboard-list__item--row">
                <div className="dashboard-list__item-row">
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
                        const base = routeActive || isActive ? className : "dashboard-list__button";
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
                </div>
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
        <span className="dashboard-list__name">{item.name}</span>
        {renderBadge?.(item)}
      </span>
      {item.subtitle !== undefined ? (
        <span className="dashboard-list__subtitle">{item.subtitle}</span>
      ) : null}
    </span>
  );
}
