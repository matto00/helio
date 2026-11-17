// HEL-1705 H: the one client rule for the order of an Output's columns, the mirror of the server's `RowColumnOrder`: the
// Output's declared schema names first, in schema order, then every other key in ascending code-point order. A rows response
// carries its page's order as `columns`; a saved window that spans several pages merges them here, because only the Output's
// schema can say where a name first seen on a later page belongs.

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `names` in the server's order for an Output declaring `schemaNames`. */
export function orderColumns(names: Iterable<string>, schemaNames: readonly string[]): string[] {
  const present = new Set(names);
  const named = new Set(schemaNames);
  const inSchema = schemaNames.filter((n, i) => present.has(n) && schemaNames.indexOf(n) === i);
  const extras = [...present].filter((n) => !named.has(n)).sort(byCodePoint);
  return [...inSchema, ...extras];
}

/** The columns of a window after another page arrives: the union of both pages' names in the server's order. Without the
 *  Output's schema (its meta is not cached) the existing order stands and new names follow it. */
export function mergeColumns(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
  schemaNames: readonly string[] | undefined,
): string[] | undefined {
  if (incoming === undefined) return existing === undefined ? undefined : [...existing];
  if (existing === undefined) return [...incoming];
  const union = new Set([...existing, ...incoming]);
  if (schemaNames === undefined || schemaNames.length === 0) {
    return [...existing, ...incoming.filter((n) => !existing.includes(n))];
  }
  return orderColumns(union, schemaNames);
}
