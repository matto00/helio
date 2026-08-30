#!/usr/bin/env node
// Asserts that every co-versioned production dependency family in
// `.github/dependabot.yml` resolves to exactly ONE Dependabot group, so a
// family that must upgrade together cannot arrive as separate PRs that each
// build its own member against the others' old versions (HEL-898: four
// `@fortawesome/*` PRs, two of which failed `frontend` with
// `TS2322: Type 'IconDefinition' is not assignable to type 'IconProp'`).
//
// Three failure modes, all enforced here rather than asked for in a comment:
//   1. A declared family's members resolve to different groups, or to none.
//   2. A declared member is absent from the manifest for its directory --
//      a stale declaration, which is how the table below would rot into
//      decoration.
//   3. A manifest `dependencies` entry that is on neither the family table
//      nor `DECLARED_INDEPENDENT`. This is the control: `react-grid-layout`
//      was missed by a hand-written enumeration of exactly this table while
//      a PR bumping it was open, so the enumeration is not trusted to be
//      complete -- it is checked.
//
// Group assignment reimplements Dependabot's documented FIRST-MATCH-WINS
// semantics over declaration order, which is why group ordering in the YAML
// is load-bearing: a `dependency-type: development` catch-all declared ahead
// of a pattern group captures every devDependency the pattern group meant to
// claim (`@types/react*`).
//
// No YAML dependency, by design: this runs as a `.husky/pre-commit` gate in
// linked worktrees where the root `node_modules` may be absent entirely. The
// parser below is a purpose-built subset parser scoped to this one file's
// shape, not a general YAML implementation.
//
// Usage: node check-dependabot-groups.mjs [repoRoot]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Declared families and independents (openspec .../design.md Decision 1)
// ---------------------------------------------------------------------------

export const DECLARED_FAMILIES = [
  {
    name: "fortawesome",
    ecosystem: "npm",
    directory: "/frontend",
    members: [
      "@fortawesome/fontawesome-svg-core",
      "@fortawesome/free-brands-svg-icons",
      "@fortawesome/free-solid-svg-icons",
      "@fortawesome/react-fontawesome",
    ],
  },
  {
    name: "echarts",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["echarts", "echarts-for-react"],
  },
  {
    name: "redux",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["@reduxjs/toolkit", "react-redux"],
  },
  {
    name: "markdown",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["react-markdown", "remark-gfm"],
  },
  // Present so Decision 2's ordering claim is asserted rather than asserted-at:
  // `@types/react`/`@types/react-dom` are devDependencies, so they land in the
  // `dev-dependencies` catch-all unless the pattern group is declared first.
  {
    name: "react",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["react", "react-dom", "@types/react", "@types/react-dom"],
  },
];

// Verbatim from the independent rows of design.md Decision 1. A package here
// is a ruled judgement ("no manifest sibling it can skew against"), not an
// oversight -- which is what distinguishes it from a coverage failure.
export const DECLARED_INDEPENDENT = [
  { ecosystem: "npm", directory: "/frontend", packages: ["react-grid-layout"] },
  { ecosystem: "npm", directory: "/frontend", packages: ["react-router-dom"] },
  { ecosystem: "npm", directory: "/frontend", packages: ["axios"] },
  { ecosystem: "npm", directory: "/frontend", packages: ["lucide-react"] },
  { ecosystem: "npm", directory: "/frontend", packages: ["qrcode.react"] },
  { ecosystem: "npm", directory: "/frontend", packages: ["tslib"] },
  { ecosystem: "npm", directory: "/", packages: ["react-markdown"] },
];

// ---------------------------------------------------------------------------
// YAML subset parser
// ---------------------------------------------------------------------------

function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

function parseFlowSequence(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  const items = [];
  let current = "";
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(unquote(current));
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(unquote(current));
  return items.filter((i) => i !== "");
}

function parseScalar(s) {
  const t = s.trim();
  if (t.startsWith("[") && t.endsWith("]")) return parseFlowSequence(t);
  const v = unquote(t);
  if (/^-?\d+$/.test(v) && t === v) return Number(v);
  return v;
}

function tokenize(text) {
  const tokens = [];
  text.split("\n").forEach((raw, idx) => {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") return;
    tokens.push({
      indent: stripped.match(/^ */)[0].length,
      text: stripped.trim(),
      line: idx + 1,
    });
  });
  return tokens;
}

function parseNode(tokens, pos, indent) {
  if (tokens[pos].text === "-" || tokens[pos].text.startsWith("- ")) {
    return parseSequence(tokens, pos, indent);
  }
  return parseMapping(tokens, pos, indent);
}

function parseSequence(tokens, pos, indent) {
  const items = [];
  while (
    pos < tokens.length &&
    tokens[pos].indent === indent &&
    tokens[pos].text.startsWith("- ")
  ) {
    const head = tokens[pos];
    const inline = head.text.slice(2).trim();
    const childIndent = indent + 2;
    pos++;
    const rest = [];
    while (pos < tokens.length && tokens[pos].indent > indent) {
      rest.push(tokens[pos]);
      pos++;
    }
    if (/^[^:]+:(\s|$)/.test(inline)) {
      const sub = [{ indent: childIndent, text: inline, line: head.line }, ...rest];
      items.push(parseMapping(sub, 0, childIndent)[0]);
    } else {
      items.push(parseScalar(inline));
    }
  }
  return [items, pos];
}

function parseMapping(tokens, pos, indent) {
  const obj = {};
  while (
    pos < tokens.length &&
    tokens[pos].indent === indent &&
    !tokens[pos].text.startsWith("- ")
  ) {
    const token = tokens[pos];
    const m = /^([^:]+):\s*(.*)$/.exec(token.text);
    if (!m) throw new Error(`unparsable line ${token.line}: ${token.text}`);
    const key = unquote(m[1]);
    const rest = m[2].trim();
    pos++;
    if (rest !== "") {
      obj[key] = parseScalar(rest);
      continue;
    }
    const next = tokens[pos];
    const isNestedBlock =
      next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")));
    if (isNestedBlock) {
      const [value, nextPos] = parseNode(tokens, pos, next.indent);
      obj[key] = value;
      pos = nextPos;
    } else {
      obj[key] = null;
    }
  }
  return [obj, pos];
}

/** Parse the dependabot config subset into `{ version, updates: [...] }`. */
export function parseDependabotYaml(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return {};
  return parseMapping(tokens, 0, tokens[0].indent)[0];
}

// ---------------------------------------------------------------------------
// Dependabot group assignment
// ---------------------------------------------------------------------------

/**
 * Match a Dependabot group pattern against a package name. Anchored at BOTH
 * ends with `*` as the only wildcard: an unanchored/substring matcher would
 * let a wrong config pass for the wrong reason (design.md Decision 2).
 */
export function matchesPattern(pattern, name) {
  const source =
    "^" +
    pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*") +
    "$";
  return new RegExp(source).test(name);
}

/**
 * Reimplements Dependabot's first-match-wins assignment over the groups of one
 * update config, in DECLARATION ORDER. Returns the group name, or null when the
 * package falls into no group (an individual PR).
 */
export function assignGroup(packageName, groups, manifest) {
  for (const [groupName, spec] of Object.entries(groups ?? {})) {
    if (!spec) continue;
    const patterns = spec.patterns ?? [];
    if (patterns.some((p) => matchesPattern(p, packageName))) return groupName;
    const dependencyType = spec["dependency-type"];
    if (dependencyType === "development" && manifest.devDependencies?.[packageName]) {
      return groupName;
    }
    if (dependencyType === "production" && manifest.dependencies?.[packageName]) {
      return groupName;
    }
  }
  return null;
}

function findUpdate(config, ecosystem, directory) {
  return (config.updates ?? []).find(
    (u) => u["package-ecosystem"] === ecosystem && u.directory === directory,
  );
}

function manifestKey(ecosystem, directory) {
  return `${ecosystem}:${directory}`;
}

/**
 * @param {object} args
 * @param {string} args.configText raw `.github/dependabot.yml` contents
 * @param {Record<string, object>} args.manifests keyed by `${ecosystem}:${directory}`
 * @param {object[]} [args.families]
 * @param {object[]} [args.independents]
 * @returns {{ errors: string[] }}
 */
export function checkDependabotGroups({
  configText,
  manifests,
  families = DECLARED_FAMILIES,
  independents = DECLARED_INDEPENDENT,
}) {
  const errors = [];
  let config;
  try {
    config = parseDependabotYaml(configText);
  } catch (err) {
    return { errors: [`could not parse .github/dependabot.yml: ${err.message}`] };
  }

  for (const family of families) {
    const update = findUpdate(config, family.ecosystem, family.directory);
    if (!update) {
      errors.push(
        `family "${family.name}": no ${family.ecosystem} update config for directory "${family.directory}"`,
      );
      continue;
    }
    const manifest = manifests[manifestKey(family.ecosystem, family.directory)];
    if (!manifest) {
      errors.push(
        `family "${family.name}": no manifest available for "${family.directory}" — cannot resolve dependency-type groups`,
      );
      continue;
    }

    const assignments = new Map();
    for (const member of family.members) {
      const declared =
        manifest.dependencies?.[member] !== undefined ||
        manifest.devDependencies?.[member] !== undefined;
      if (!declared) {
        errors.push(
          `family "${family.name}": declared member "${member}" is not in ${family.directory}/package.json — stale declaration`,
        );
        continue;
      }
      assignments.set(member, assignGroup(member, update.groups, manifest));
    }

    const ungrouped = [...assignments].filter(([, g]) => g === null).map(([m]) => m);
    if (ungrouped.length > 0) {
      errors.push(
        `family "${family.name}" is split/ungrouped: ${ungrouped.join(", ")} resolve to no group in ${family.ecosystem} ${family.directory} — each would arrive as its own PR`,
      );
    }
    const groupNames = [...new Set([...assignments.values()].filter((g) => g !== null))];
    if (groupNames.length > 1) {
      const detail = [...assignments]
        .map(([m, g]) => `${m} -> ${g === null ? "(none)" : g}`)
        .join(", ");
      errors.push(
        `family "${family.name}" is split across ${groupNames.length} groups (${groupNames.join(", ")}): ${detail}`,
      );
    }
  }

  for (const update of config.updates ?? []) {
    const ecosystem = update["package-ecosystem"];
    const directory = update.directory;
    const manifest = manifests[manifestKey(ecosystem, directory)];
    if (!manifest) continue;
    const covered = new Set();
    for (const family of families) {
      if (family.ecosystem === ecosystem && family.directory === directory) {
        for (const member of family.members) covered.add(member);
      }
    }
    for (const entry of independents) {
      if (entry.ecosystem === ecosystem && entry.directory === directory) {
        for (const pkg of entry.packages) covered.add(pkg);
      }
    }
    for (const pkg of Object.keys(manifest.dependencies ?? {})) {
      if (!covered.has(pkg)) {
        errors.push(
          `unaccounted production dependency "${pkg}" in ${directory}/package.json — add it to a declared family or to DECLARED_INDEPENDENT with a justification`,
        );
      }
    }
  }

  return { errors };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = join(repoRoot, ".github/dependabot.yml");
  const configText = readFileSync(configPath, "utf8");

  const manifests = {};
  for (const directory of ["/", "/frontend"]) {
    const path = join(repoRoot, directory.replace(/^\//, ""), "package.json");
    try {
      manifests[manifestKey("npm", directory)] = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // A directory with no manifest is simply not coverage-checked; the
      // family loop reports it explicitly if a family needed it.
    }
  }

  const { errors } = checkDependabotGroups({ configText, manifests });
  if (errors.length > 0) {
    console.error("check-dependabot-groups: FAILED\n");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\n${errors.length} problem(s). Co-versioned families must upgrade in one PR; see openspec design.md Decision 1.`,
    );
    process.exit(1);
  }
  console.log(
    `check-dependabot-groups: OK — ${DECLARED_FAMILIES.length} declared families each resolve to a single group; every production dependency accounted for.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
