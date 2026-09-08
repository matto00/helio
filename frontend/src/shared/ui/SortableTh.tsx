import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSort, faSortDown, faSortUp } from "@fortawesome/free-solid-svg-icons";

import type { SortDirection } from "./useSortedRows";
import "./SortableTh.css";

interface SortableThProps {
  /** Rendered header label. */
  children: ReactNode;
  /** This header's own sort direction, or `null` when a DIFFERENT column is
   *  currently driving the sort (renders the neutral, unsorted affordance). */
  direction: SortDirection | null;
  onSort: () => void;
  className?: string;
  scope?: "col";
}

/** A clickable, keyboard-accessible `<th>` that drives one column of
 *  `useSortedRows`. Owns its own `aria-sort` (per the WAI-ARIA table sort
 *  pattern: exactly one header at a time carries `"ascending"`/
 *  `"descending"`, every other sortable header carries `"none"`) and a
 *  direction glyph that never relies on color alone. */
export function SortableTh({
  children,
  direction,
  onSort,
  className,
  scope = "col",
}: SortableThProps) {
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
  return (
    <th scope={scope} className={className} aria-sort={ariaSort}>
      <button type="button" className="sortable-th__btn" onClick={onSort}>
        <span>{children}</span>
        <FontAwesomeIcon
          className={`sortable-th__glyph${direction === null ? " sortable-th__glyph--neutral" : ""}`}
          icon={direction === "asc" ? faSortUp : direction === "desc" ? faSortDown : faSort}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}
