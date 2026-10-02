// HEL-1148 design.md D6: which canonical panel kinds are agent-facing, derived from "can the
// proposal wire express the kind's required binding" instead of a hardcoded kind name.
//
// A canonical kind is agent-facing unless it is in AGENT_SURFACE_EXCLUSIONS (a `{ kind: reason }`
// table); and every agent-facing kind's required binding field (`outputId` for the Output-bound
// kinds, `dataSourceId` for the source-bound kinds, both declared in DashboardProposalService.scala)
// must exist on every proposal-wire surface. Adding a future bound kind without a wire field
// therefore fails `npm run check:schemas`, and an excluded kind that later gains a binding must be
// re-decided (it fails) rather than staying excluded by inertia. Pure helpers, no I/O: exercised by
// scripts/check-schema-drift.selftest.mjs.

/** Kinds left off the agent-facing surfaces on purpose, each with its stated reason. The reason is a
 *  product-scope one, NOT a binding predicate: `divider` IS expressible on the wire (`orientation`),
 *  it is excluded because it is purely presentational. */
export const AGENT_SURFACE_EXCLUSIONS = {
  divider:
    "purely presentational layout chrome: no content, binding or data an agent can author; " +
    "create_panel's enum excludes it, and the proposal surfaces mirror that parity",
};

/** Canonical kinds minus the explicit exclusion table, preserving canonical order. */
export function deriveAgentFacingPanelTypes(canonicalKinds, exclusions) {
  return canonicalKinds.filter((kind) => !Object.hasOwn(exclusions, kind));
}

/** Errors for an exclusion table that is not itself sound: every entry needs a stated reason, must
 *  name a real canonical kind (no stale entry), and must not be a bound kind (`bindings` maps a
 *  bound kind to its required wire field). */
export function validateExclusions({ canonicalKinds, exclusions, bindings }) {
  const errors = [];
  for (const [kind, reason] of Object.entries(exclusions)) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      errors.push(`agent-surface exclusion "${kind}" has no stated reason`);
    }
    if (!canonicalKinds.includes(kind)) {
      errors.push(`agent-surface exclusion "${kind}" is not a canonical panel kind (stale entry)`);
    }
    if (Object.hasOwn(bindings, kind)) {
      errors.push(
        `agent-surface exclusion "${kind}" is a bound kind (requires ${bindings[kind]}); ` +
          `re-decide it instead of excluding it by inertia`,
      );
    }
  }
  return errors;
}

/** Errors for every (bound kind, surface) pair whose surface lacks the kind's required binding
 *  field. `surfaces` is `[{ label, fields: Set<string> }]`. */
export function validateWireExpressibility({ bindings, surfaces }) {
  const errors = [];
  for (const [kind, field] of Object.entries(bindings)) {
    for (const { label, fields } of surfaces) {
      if (!fields.has(field)) {
        errors.push(
          `${label}: cannot express "${field}", the required binding of the agent-facing "${kind}" kind`,
        );
      }
    }
  }
  return errors;
}

/** Parses `<name>: Set[String] = Set("a", "b")` out of Scala source. Throws (naming `name` and the
 *  file) when the declaration is absent, unparseable, or empty: an empty set would make the
 *  expressibility check above vacuous, which is exactly the silent failure this guards against. */
export function parseKindSet(src, name, file) {
  const match = src.match(new RegExp(`${name}:\\s*Set\\[String\\]\\s*=\\s*Set\\(([^)]*)\\)`));
  if (!match) throw new Error(`${file}: could not find "${name}: Set[String] = Set(...)"`);
  const kinds = [...match[1].matchAll(/"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  if (kinds.length === 0) {
    throw new Error(
      `${file}: "${name}" parsed to an empty set; the wire-expressibility check would be vacuous`,
    );
  }
  return kinds;
}
