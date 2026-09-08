import { useMemo, useState } from "react";

import { groupFieldsByNamespace } from "./groupFieldsByNamespace";

/** At or below this many fields, `SchemaFieldViewer` skips every bit of
 *  chrome (search box, namespace grouping, cap) and renders a plain flat
 *  list -- most sources have a handful of fields, and paying the grouping
 *  tax there would make the common case worse, not better (HEL-1022). */
export const SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD = 12;

/** Fields shown per group (or in the flat/filtered list) before "Show all
 *  N" is needed. Chosen well above the small-count threshold so a
 *  medium-sized, ungrouped source never sees a cap it doesn't need, and
 *  well below a real `player.metadata`-sized namespace (134 fields) so
 *  expanding a huge group doesn't just move the flood into the group body. */
export const SCHEMA_FIELD_VIEWER_GROUP_CAP = 20;

export interface SchemaFieldGroupState<F> {
  key: string;
  fields: readonly F[];
  isExpanded: boolean;
  toggle: () => void;
  /** Fields to actually render -- empty while collapsed, capped-or-full
   *  while expanded. */
  visibleFields: readonly F[];
  hasMore: boolean;
  isShowingAll: boolean;
  showAll: () => void;
}

export interface SchemaFieldFlatState<F> {
  fields: readonly F[];
  visibleFields: readonly F[];
  hasMore: boolean;
  isShowingAll: boolean;
  showAll: () => void;
}

export interface UseSchemaFieldSearchResult<F> {
  totalCount: number;
  /** `true` at or below the small-count threshold -- the caller should
   *  render fields directly with no chrome at all when this is `true`. */
  isSmall: boolean;
  query: string;
  setQuery: (query: string) => void;
  isFiltering: boolean;
  /** Populated when NOT filtering and grouping would actually help (more
   *  than one real namespace) -- render these as collapsible sections.
   *  `null` otherwise. */
  groups: SchemaFieldGroupState<F>[] | null;
  /** Populated when filtering (matches shown flat across every namespace,
   *  never still boxed per group), or when there's nothing to usefully
   *  group (0 or 1 namespace) -- render this as one capped list. `null`
   *  when `groups` is populated instead. Exactly one of `groups`/`flat` is
   *  non-null whenever `isSmall` is `false`. */
  flat: SchemaFieldFlatState<F> | null;
}

/**
 * Presentation-agnostic search/group/cap state for a (potentially large)
 * flat field list. Returns plain data + callbacks; renders nothing itself
 * so it can back both a table view (`SchemaFieldViewer`, source detail) and
 * a chip view (pipeline footer) without either being forced into the
 * other's markup.
 */
export function useSchemaFieldSearch<F>(
  fields: readonly F[],
  getName: (field: F) => string,
  options?: { smallThreshold?: number; groupCap?: number },
): UseSchemaFieldSearchResult<F> {
  const smallThreshold = options?.smallThreshold ?? SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD;
  const groupCap = options?.groupCap ?? SCHEMA_FIELD_VIEWER_GROUP_CAP;

  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedShowAllGroups, setExpandedShowAllGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [showAllFlat, setShowAllFlat] = useState(false);

  const totalCount = fields.length;
  const isSmall = totalCount <= smallThreshold;

  const normalizedQuery = query.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;

  const filteredFields = useMemo(() => {
    if (!isFiltering) return fields;
    return fields.filter((f) => getName(f).toLowerCase().includes(normalizedQuery));
  }, [fields, getName, isFiltering, normalizedQuery]);

  const namespaceGroups = useMemo(
    () => groupFieldsByNamespace(filteredFields, getName),
    [filteredFields, getName],
  );

  // Grouping only helps when there's more than one real namespace to
  // separate -- one group (or zero, an empty filtered result) is just the
  // flat list with extra chrome around it.
  const useGrouping = !isFiltering && !isSmall && namespaceGroups.length > 1;

  const groups: SchemaFieldGroupState<F>[] | null = useGrouping
    ? namespaceGroups.map((g) => {
        const isExpanded = expandedGroups.has(g.key);
        const isShowingAll = expandedShowAllGroups.has(g.key);
        const visibleFields = isExpanded
          ? isShowingAll
            ? g.fields
            : g.fields.slice(0, groupCap)
          : [];
        return {
          key: g.key,
          fields: g.fields,
          isExpanded,
          toggle: () =>
            setExpandedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(g.key)) next.delete(g.key);
              else next.add(g.key);
              return next;
            }),
          visibleFields,
          hasMore: g.fields.length > groupCap,
          isShowingAll,
          showAll: () => setExpandedShowAllGroups((prev) => new Set(prev).add(g.key)),
        };
      })
    : null;

  const flat: SchemaFieldFlatState<F> | null = !useGrouping
    ? {
        fields: filteredFields,
        visibleFields: isSmall || showAllFlat ? filteredFields : filteredFields.slice(0, groupCap),
        hasMore: !isSmall && filteredFields.length > groupCap,
        isShowingAll: isSmall || showAllFlat,
        showAll: () => setShowAllFlat(true),
      }
    : null;

  return { totalCount, isSmall, query, setQuery, isFiltering, groups, flat };
}
