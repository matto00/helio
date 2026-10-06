export type HistoryRow = Record<string, unknown>;

export interface RowDiff {
  /** Selected-point rows with no unconsumed whole-row match in the comparison, by object identity. */
  changed: Set<HistoryRow>;
  /** Comparison rows with no match in the selected point. */
  noLongerPresent: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** HEL-1277 design D7 — whole-row multiset diff. A row's identity is its content with keys sorted
 *  recursively (key order is irrelevant; `1` and `"1"` differ). Every selected row that cannot
 *  consume a matching comparison row is `changed`; leftover comparison rows are `noLongerPresent`.
 *  Only call this when BOTH sides' payloads are loaded — a missing payload is never an empty side. */
export function diffRows(selected: HistoryRow[], comparison: HistoryRow[]): RowDiff {
  const remaining = new Map<string, number>();
  for (const row of comparison) {
    const key = canonical(row);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const changed = new Set<HistoryRow>();
  for (const row of selected) {
    const key = canonical(row);
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else changed.add(row);
  }
  let noLongerPresent = 0;
  remaining.forEach((n) => {
    noLongerPresent += n;
  });
  return { changed, noLongerPresent };
}
