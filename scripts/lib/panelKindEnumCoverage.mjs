// HEL-1412 / HEL-1149: coverage check for the panel-kind enum parity guard in
// scripts/check-schema-drift.mjs. That guard only compares the enums it is told about
// (panelTypeSurfaces), so a schema carrying a panel-kind enum could sit outside it unnoticed
// (create-panels-batch-request.schema.json did). These pure helpers find every panel-kind enum
// under schemas/ and require each to be a checked surface or an explicit, reasoned exemption.

/** An `enum` array counts as a panel-kind enum when it holds at least this many canonical panel
 *  kinds. Measured 2026-10-09: panel-kind enums hold 5-6, every other schema enum at most 1. */
export const PANEL_KIND_ENUM_MIN_HITS = 2;

/** Panel-kind enums deliberately NOT parity-checked. Key: enumKey(file, path); value: the reason.
 *  Empty: every detected panel-kind enum is a checked surface. */
export const PANEL_KIND_ENUM_EXEMPTIONS = {};

/** `<path under schemas/>#<dot-joined JSON path to the enum array>`. */
export function enumKey(file, path) {
  return `${file}#${path.join(".")}`;
}

/** JSON paths (arrays of keys ending in "enum") of every enum array in `schema` holding at least
 *  `minHits` of `canonicalKinds`. */
export function findPanelKindEnums(schema, canonicalKinds, minHits = PANEL_KIND_ENUM_MIN_HITS) {
  const kinds = new Set(canonicalKinds);
  const found = [];
  function visit(node, path) {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, [...path, String(i)]));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" && Array.isArray(value)) {
        if (value.filter((v) => kinds.has(v)).length >= minHits) found.push([...path, key]);
      } else {
        visit(value, [...path, key]);
      }
    }
  }
  visit(schema, []);
  return found;
}

/** detected / covered: arrays of { file, path }; exemptions: { [enumKey]: reason }.
 *  Returns error strings (empty when every detected enum is checked or exempted). */
export function validatePanelKindEnumCoverage({ detected, covered, exemptions }) {
  const errors = [];
  const coveredKeys = new Set(covered.map(({ file, path }) => enumKey(file, path)));
  const detectedKeys = new Set(detected.map(({ file, path }) => enumKey(file, path)));
  for (const key of detectedKeys) {
    if (!coveredKeys.has(key) && !(key in exemptions)) {
      errors.push(
        `panel-kind enum coverage: schemas/${key} holds a panel-kind enum but is neither a ` +
          "checked surface (panelTypeSurfaces in scripts/check-schema-drift.mjs) nor exempted " +
          "(PANEL_KIND_ENUM_EXEMPTIONS in scripts/lib/panelKindEnumCoverage.mjs)",
      );
    }
  }
  for (const [key, reason] of Object.entries(exemptions)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(`panel-kind enum coverage: exemption ${key} has no stated reason`);
    }
    if (!detectedKeys.has(key)) {
      errors.push(`panel-kind enum coverage: exemption ${key} is stale (no panel-kind enum there)`);
    }
    if (coveredKeys.has(key)) {
      errors.push(
        `panel-kind enum coverage: ${key} is both a checked surface and exempted; remove the exemption`,
      );
    }
  }
  return errors;
}
