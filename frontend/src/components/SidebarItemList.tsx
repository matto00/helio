import { useState } from "react";
import { NavLink } from "react-router-dom";

import "./DashboardList.css";
import { ActionsMenu } from "./ActionsMenu";

interface SidebarItem {
  id: string;
  name: string;
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
  /** If provided, renders a "+" button in the header that triggers onAdd. */
  onAdd?: () => void;
  /** Accessible label for the "+" button (defaults to "Add <heading>"). */
  addLabel?: string;
  /** If provided, an ellipsis menu is rendered per row with a Delete action.
   * Selecting Delete swaps the row for an inline Confirm/Cancel pair *below*
   * the item so confirmation buttons don't get squeezed beside narrow rows. */
  onDelete?: (item: SidebarItem) => void | Promise<void>;
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
  onAdd,
  addLabel,
  onDelete,
}: SidebarItemListProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const normalizedQuery = filterQuery.toLowerCase().trim();
  const filtered =
    normalizedQuery.length === 0
      ? items
      : items.filter((item) => item.name.toLowerCase().includes(normalizedQuery));

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
          <input
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
              ✕
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
        <p className="dashboard-list__status">
          {normalizedQuery.length > 0
            ? "No matches"
            : (emptyText ?? `No ${heading.toLowerCase()} yet`)}
        </p>
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
                      className={className}
                      aria-pressed={isActive}
                      onClick={() => onSelect(item)}
                    >
                      <span className="dashboard-list__name">{item.name}</span>
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
                      className={({ isActive: routeActive }) =>
                        routeActive || isActive ? className : "dashboard-list__button"
                      }
                      end
                    >
                      <span className="dashboard-list__name">{item.name}</span>
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
