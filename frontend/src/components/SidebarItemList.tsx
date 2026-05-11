import { useState } from "react";
import { NavLink } from "react-router-dom";

import "./DashboardList.css";

interface SidebarItem {
  id: string;
  name: string;
}

interface SidebarItemListProps {
  heading: string;
  items: SidebarItem[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error?: string | null;
  /** Build the route to navigate to for a given item. */
  toHref: (item: SidebarItem) => string;
  /** Optional id of the currently-active item — surfaces the active-dot affordance. */
  activeId?: string | null;
  /** Optional placeholder when the list is empty and not loading. */
  emptyText?: string;
  filterLabel?: string;
}

export function SidebarItemList({
  heading,
  items,
  status,
  error,
  toHref,
  activeId,
  emptyText,
}: SidebarItemListProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedQuery = filterQuery.toLowerCase().trim();
  const filtered =
    normalizedQuery.length === 0
      ? items
      : items.filter((item) => item.name.toLowerCase().includes(normalizedQuery));

  return (
    <section className="dashboard-list" aria-label={heading.toLowerCase()}>
      <header className="dashboard-list__header">
        <h2>{heading}</h2>
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
            return (
              <li key={item.id} className="dashboard-list__item">
                <NavLink
                  to={toHref(item)}
                  className={({ isActive: routeActive }) =>
                    routeActive || isActive
                      ? "dashboard-list__button dashboard-list__button--active"
                      : "dashboard-list__button"
                  }
                  end
                >
                  <span className="dashboard-list__name">{item.name}</span>
                  {isActive ? (
                    <span
                      className="dashboard-list__active-dot"
                      aria-label={`Active ${heading.toLowerCase().replace(/s$/, "")}`}
                    />
                  ) : null}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
