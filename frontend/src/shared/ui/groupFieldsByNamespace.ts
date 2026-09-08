/**
 * Groups a flat list of dotted-path field names into namespaces, one level
 * deep: the group key is everything BEFORE THE LAST DOT (the full prefix),
 * not a recursive tree keyed on the first segment.
 *
 * One-level, full-prefix grouping was chosen over a general nested tree
 * deliberately (HEL-1022): a REST source's ~200-field schema is typically
 * shaped like `player.metadata.injury_override_regular_2024_10` repeated
 * ~140 times with only the trailing segment varying -- grouping on the FULL
 * prefix (`player.metadata`) collapses all ~140 into one namespace row,
 * which is the actual win. Grouping on just the first segment (`player`)
 * would still leave every one of those 140 names inside a single expanded
 * group with no further structure, and a recursive multi-level tree would
 * add nested-disclosure UI for a shape this data doesn't otherwise need --
 * real-world dotted schemas here are two or three segments deep at most, and
 * the fields sharing a full prefix are exactly the ones that are usually
 * "the same kind of thing" (one row per season/week/variant). Revisit if a
 * source ever has genuinely deep, unevenly-nested paths where one level
 * isn't enough to make groups meaningfully small.
 */

export const ROOT_GROUP_KEY = "(root)";

export interface NamespaceGroup<F> {
  /** The shared dotted-path prefix (everything before the field's LAST
   *  dot), or the `ROOT_GROUP_KEY` sentinel for a field with no dot at all. */
  key: string;
  fields: F[];
}

/**
 * Pure function: groups `fields` by their dotted-path prefix. Groups are
 * returned with `ROOT_GROUP_KEY` first (top-level, usually-identifying
 * fields a reader wants immediately), then every real namespace sorted
 * alphabetically -- not insertion order, so the group list never depends on
 * whatever order the backend happened to return fields in.
 */
export function groupFieldsByNamespace<F>(
  fields: readonly F[],
  getName: (field: F) => string,
): NamespaceGroup<F>[] {
  const byKey = new Map<string, F[]>();

  for (const field of fields) {
    const name = getName(field);
    const lastDot = name.lastIndexOf(".");
    const key = lastDot === -1 ? ROOT_GROUP_KEY : name.slice(0, lastDot);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(field);
    } else {
      byKey.set(key, [field]);
    }
  }

  const rootBucket = byKey.get(ROOT_GROUP_KEY);
  const realEntries = Array.from(byKey.entries())
    .filter(([key]) => key !== ROOT_GROUP_KEY)
    .sort(([a], [b]) => a.localeCompare(b));

  const groups: NamespaceGroup<F>[] = [];
  if (rootBucket) groups.push({ key: ROOT_GROUP_KEY, fields: rootBucket });
  for (const [key, groupFields] of realEntries) groups.push({ key, fields: groupFields });
  return groups;
}
