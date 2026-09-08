import { Fragment, type ReactNode, useId } from "react";

import { useSchemaFieldSearch } from "./useSchemaFieldSearch";
import "./SchemaFieldViewer.css";

export interface SchemaFieldViewerProps<F> {
  /** Rendered in the header next to the total count, e.g. "Schema". */
  title: string;
  fields: readonly F[];
  getName: (field: F) => string;
  /** Renders ONE field's presentation unit -- a `<tr>` for a table, a chip
   *  `<span>` for a compact badge row. This component never assumes a
   *  shape here; see `fieldsContainer`. */
  renderField: (field: F) => ReactNode;
  /** Wraps one visible list's worth of already-rendered field nodes (one
   *  call per visible group, or one call for the flat/filtered list) into
   *  whatever structural container the presentation needs -- a
   *  `<table>…<tbody>{children}</tbody></table>` for a table view (the
   *  caller supplies its own `<thead>`), or a flex-wrap `<div>` for a chip
   *  row. Keeps this component presentation-agnostic: it owns the
   *  search/group/cap CHROME, never the visual shape of a field itself. */
  fieldsContainer: (children: ReactNode) => ReactNode;
  /** At or below this many fields, renders as a plain flat list with NO
   *  chrome at all (no search box, no grouping, no cap) -- see
   *  `SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD`'s doc for why. */
  smallThreshold?: number;
  /** Fields shown per group / in the flat list before "Show all N".
   *  See `SCHEMA_FIELD_VIEWER_GROUP_CAP`'s doc. */
  groupCap?: number;
  className?: string;
}

function renderVisible<F>(
  fields: readonly F[],
  getName: (field: F) => string,
  renderField: (field: F) => ReactNode,
): ReactNode {
  return fields.map((f) => <Fragment key={getName(f)}>{renderField(f)}</Fragment>);
}

/**
 * Shared search/group/cap chrome for a (potentially large) dotted-path
 * field list -- built on `useSchemaFieldSearch`, which owns all the actual
 * state. This component owns only the DOM: the header/count, the filter
 * input, the collapsible namespace disclosures, and the "Show all N"
 * affordance. What a single field or a visible list renders AS is entirely
 * up to the caller (`renderField`/`fieldsContainer`), so a table-shaped
 * consumer (`SourceDetailPanel`) and a chip-shaped consumer (a pipeline
 * footer disclosure) can both use this without either being forced into
 * the other's markup.
 */
export function SchemaFieldViewer<F>({
  title,
  fields,
  getName,
  renderField,
  fieldsContainer,
  smallThreshold,
  groupCap,
  className,
}: SchemaFieldViewerProps<F>) {
  const search = useSchemaFieldSearch(fields, getName, { smallThreshold, groupCap });
  const filterId = useId();
  const classes = ["schema-field-viewer", className].filter(Boolean).join(" ");

  // Small case: no header, no count chip, no search box, no grouping --
  // just the fields, exactly as if this component didn't exist. A 5-field
  // source must never look more complicated than it is.
  if (search.isSmall) {
    return (
      <div className={classes}>{fieldsContainer(renderVisible(fields, getName, renderField))}</div>
    );
  }

  return (
    <div className={classes}>
      <div className="schema-field-viewer__header">
        <span className="eyebrow schema-field-viewer__title">{title}</span>
        <span className="schema-field-viewer__count">
          {search.totalCount} field{search.totalCount === 1 ? "" : "s"}
        </span>
      </div>

      <label className="sr-only" htmlFor={filterId}>
        Filter {title.toLowerCase()} by name
      </label>
      <input
        id={filterId}
        type="search"
        className="schema-field-viewer__filter"
        placeholder={`Filter ${search.totalCount} fields…`}
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
      />

      {search.groups ? (
        <ul className="schema-field-viewer__groups">
          {search.groups.map((group) => (
            <li key={group.key} className="schema-field-viewer__group">
              <button
                type="button"
                className="schema-field-viewer__group-toggle"
                aria-expanded={group.isExpanded}
                onClick={group.toggle}
              >
                <span className="schema-field-viewer__group-chevron" aria-hidden="true">
                  {group.isExpanded ? "▾" : "▸"}
                </span>
                <span className="schema-field-viewer__group-name">{group.key}</span>
                <span className="schema-field-viewer__group-count">{group.fields.length}</span>
              </button>
              {group.isExpanded && (
                <div className="schema-field-viewer__group-body">
                  {fieldsContainer(renderVisible(group.visibleFields, getName, renderField))}
                  {group.hasMore && !group.isShowingAll && (
                    <button
                      type="button"
                      className="schema-field-viewer__show-all"
                      onClick={group.showAll}
                    >
                      Show all {group.fields.length}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="schema-field-viewer__flat">
          {search.flat && search.flat.fields.length === 0 ? (
            <p className="schema-field-viewer__empty">
              No fields match &ldquo;{search.query}&rdquo;.
            </p>
          ) : (
            <>
              {fieldsContainer(
                renderVisible(search.flat?.visibleFields ?? [], getName, renderField),
              )}
              {search.flat?.hasMore && !search.flat.isShowingAll && (
                <button
                  type="button"
                  className="schema-field-viewer__show-all"
                  onClick={search.flat.showAll}
                >
                  Show all {search.flat.fields.length}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
