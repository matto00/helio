#!/usr/bin/env node
// Verifies that JSON Schemas in `schemas/` agree with the matching
// case classes in backend/.../JsonProtocols.scala (aggregator) and every
// per-domain trait under backend/.../api/protocols/. Exits non-zero on drift.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(repoRoot, "schemas");
const protocolsAggregator = join(
  repoRoot,
  "backend/src/main/scala/com/helio/api/JsonProtocols.scala",
);
const protocolsDir = join(repoRoot, "backend/src/main/scala/com/helio/api/protocols");
const modelScala = join(repoRoot, "backend/src/main/scala/com/helio/domain/model.scala");
const proposalServiceScala = join(
  repoRoot,
  "backend/src/main/scala/com/helio/services/DashboardProposalService.scala",
);
const helioMcpProposalTs = join(repoRoot, "helio-mcp/src/tools/proposal.ts");
const proposalReviewTsx = join(repoRoot, "frontend/src/features/dashboards/ui/ProposalReview.tsx");

// Extract `case class <Name>(<params>)` (handles multi-line param lists).
// Returns Map<className, fieldName[]>.
function parseCaseClasses(src) {
  const map = new Map();
  const re = /case class\s+(\w+)\s*\(([^)]*)\)/gs;
  for (const match of src.matchAll(re)) {
    const [, name, paramsRaw] = match;
    const fields = paramsRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // strip default value, then take the param name before `:`
        const noDefault = p.split("=")[0].trim();
        const ident = noDefault.split(":")[0].trim();
        return ident.replace(/^`(.+)`$/, "$1"); // unwrap backticked keywords
      })
      .filter(Boolean);
    map.set(name, fields);
  }
  return map;
}

// Aggregate case classes across the aggregator and every per-domain trait.
// Guard against duplicates — if the same case class appears in two files,
// the split has been violated.
const sources = [
  protocolsAggregator,
  ...readdirSync(protocolsDir)
    .filter((f) => f.endsWith(".scala"))
    .map((f) => join(protocolsDir, f)),
];

const classes = new Map();
const classOrigin = new Map();
for (const src of sources) {
  const fileSrc = readFileSync(src, "utf8");
  for (const [name, fields] of parseCaseClasses(fileSrc)) {
    if (classes.has(name)) {
      console.error(
        `Duplicate case class "${name}" found in both ${classOrigin.get(name)} and ${src}`,
      );
      process.exit(1);
    }
    classes.set(name, fields);
    classOrigin.set(name, src);
  }
}

// Schemas that don't map 1:1 to a single case class (e.g. response shapes
// composed from multiple types). Listed explicitly so the check fails loudly
// when a new schema is added without updating this list.
const SKIP = new Set([
  "Dashboard", // response composed from Dashboard + DashboardLayout + meta
  "Panel", // response composed across PanelResponse and union variants
  "PanelQuery", // domain type, not a request payload
  "PaginatedQueryResult", // generic response wrapper
  "ResourceMeta", // matches ResourceMetaResponse; checked transitively
  "DashboardLayout", // matches DashboardLayoutPayload/Response variants
  "DashboardLayoutItem", // matches *Payload/*Response variants
  "DashboardAppearance", // matches *Payload/*Response variants
  "PanelAppearance", // matches *Payload/*Response variants
]);

const errors = [];
const checked = [];

for (const file of readdirSync(schemasDir).sort()) {
  if (!file.endsWith(".schema.json")) continue;
  const schemaPath = join(schemasDir, file);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const title = schema.title;
  if (!title) {
    errors.push(`${file}: missing "title"`);
    continue;
  }
  if (SKIP.has(title)) continue;

  const fields = classes.get(title);
  if (!fields) {
    errors.push(
      `${file}: no case class "${title}" found in JsonProtocols.scala or api/protocols/*.scala (add to SKIP set in scripts/check-schema-drift.mjs if intentional)`,
    );
    continue;
  }

  const schemaProps = new Set(Object.keys(schema.properties ?? {}));
  const classFields = new Set(fields);

  const missingInClass = [...schemaProps].filter((p) => !classFields.has(p));
  const missingInSchema = [...classFields].filter((p) => !schemaProps.has(p));

  if (missingInClass.length || missingInSchema.length) {
    const parts = [`${file} ↔ case class ${title}:`];
    if (missingInClass.length)
      parts.push(`  in schema, missing from case class: ${missingInClass.join(", ")}`);
    if (missingInSchema.length)
      parts.push(`  in case class, missing from schema: ${missingInSchema.join(", ")}`);
    errors.push(parts.join("\n"));
  } else {
    checked.push(title);
  }
}

// --- Panel-type enum parity guard (HEL-310) ---
// The canonical panel-type set lives in PanelType.fromString (model.scala) and
// the canonical *data*-panel set lives in DataPanelKinds (DashboardProposalService.scala).
// Every surface below that separately enumerates panel types must match one of
// those two canonical sets exactly, or a new/removed panel type can silently
// drift out of sync (as happened across HEL-247/HEL-305/HEL-315).

function extractBetween(src, startMarker, endMarker, file) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`${file}: could not find "${startMarker}"`);
  const endIdx = src.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx === -1)
    throw new Error(`${file}: could not find "${endMarker}" after "${startMarker}"`);
  return src.slice(startIdx, endIdx);
}

function extractQuoted(str) {
  return [...str.matchAll(/"([a-zA-Z0-9]+)"/g)].map((m) => m[1]);
}

function getEnumAt(schema, path, file) {
  let node = schema;
  for (const key of path) {
    node = node?.[key];
    if (node === undefined) {
      throw new Error(`${file}: no node at ${path.join(".")}`);
    }
  }
  if (!Array.isArray(node)) throw new Error(`${file}: ${path.join(".")} is not an enum array`);
  return node;
}

function compareSets(actual, canonical, label) {
  const actualSet = new Set(actual);
  const canonicalSet = new Set(canonical);
  const missing = canonical.filter((t) => !actualSet.has(t));
  const extra = actual.filter((t) => !canonicalSet.has(t));
  if (!missing.length && !extra.length) return null;
  const parts = [`${label}:`];
  if (missing.length) parts.push(`  missing: ${missing.join(", ")}`);
  if (extra.length) parts.push(`  unexpected: ${extra.join(", ")}`);
  return parts.join("\n");
}

const modelSrc = readFileSync(modelScala, "utf8");
const fromStringBody = extractBetween(
  modelSrc,
  "def fromString(s: String)",
  "def asString(t: PanelType)",
  modelScala,
);
// Match `case "x" => Right(...)` arms only — excludes the `case other => Left(...)` fallback.
const canonicalPanelTypes = [
  ...fromStringBody.matchAll(/case\s+"([a-zA-Z0-9]+)"\s*=>\s*Right/g),
].map((m) => m[1]);
if (canonicalPanelTypes.length < 8) {
  console.error(
    `Canonical panel-type parse from ${modelScala} yielded only ${canonicalPanelTypes.length} types ` +
      `(expected >= 8) — PanelType.fromString may have been reformatted; update the parser in this script.`,
  );
  process.exit(1);
}

const proposalServiceSrc = readFileSync(proposalServiceScala, "utf8");
const dataPanelKindsMatch = proposalServiceSrc.match(
  /DataPanelKinds:\s*Set\[String\]\s*=\s*Set\(([^)]*)\)/,
);
if (!dataPanelKindsMatch) {
  throw new Error(
    `${proposalServiceScala}: could not find "DataPanelKinds: Set[String] = Set(...)"`,
  );
}
const canonicalDataPanelKinds = extractQuoted(dataPanelKindsMatch[1]);

const panelTypeSurfaces = [
  {
    label: "schemas/create-panel-request.schema.json properties.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "create-panel-request.schema.json"), "utf8")),
      ["properties", "type", "enum"],
      "create-panel-request.schema.json",
    ),
  },
  {
    label: "schemas/panel.schema.json properties.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "panel.schema.json"), "utf8")),
      ["properties", "type", "enum"],
      "panel.schema.json",
    ),
  },
  {
    label: "schemas/update-panels-batch-request.schema.json panels.items.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "update-panels-batch-request.schema.json"), "utf8")),
      ["properties", "panels", "items", "properties", "type", "enum"],
      "update-panels-batch-request.schema.json",
    ),
  },
  {
    label: "schemas/dashboard-proposal.schema.json $defs.ProposalPanel.properties.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "dashboard-proposal.schema.json"), "utf8")),
      ["$defs", "ProposalPanel", "properties", "type", "enum"],
      "dashboard-proposal.schema.json",
    ),
  },
];

const helioMcpProposalSrc = readFileSync(helioMcpProposalTs, "utf8");
const panelTypesBody = extractBetween(
  helioMcpProposalSrc,
  "const PANEL_TYPES = [",
  "] as const;",
  helioMcpProposalTs,
);
panelTypeSurfaces.push({
  label: "helio-mcp/src/tools/proposal.ts PANEL_TYPES",
  canonical: canonicalPanelTypes,
  actual: extractQuoted(panelTypesBody),
});

const dataPanelTypeSurfaces = [
  {
    label: "helio-mcp/src/tools/proposal.ts DATA_PANEL_TYPES",
    canonical: canonicalDataPanelKinds,
    actual: extractQuoted(
      extractBetween(
        helioMcpProposalSrc,
        "const DATA_PANEL_TYPES = new Set([",
        "])",
        helioMcpProposalTs,
      ),
    ),
  },
  {
    label: "frontend/.../ProposalReview.tsx DATA_PANEL_TYPES",
    canonical: canonicalDataPanelKinds,
    actual: extractQuoted(
      extractBetween(
        readFileSync(proposalReviewTsx, "utf8"),
        "const DATA_PANEL_TYPES = new Set([",
        "])",
        proposalReviewTsx,
      ),
    ),
  },
];

let panelTypeChecked = 0;
for (const { label, canonical, actual } of [...panelTypeSurfaces, ...dataPanelTypeSurfaces]) {
  const mismatch = compareSets(actual, canonical, label);
  if (mismatch) errors.push(mismatch);
  else panelTypeChecked += 1;
}

if (errors.length) {
  console.error("Schema/JsonProtocols drift detected:\n");
  for (const e of errors) console.error(e + "\n");
  console.error(
    "Update either the schema in schemas/ or the case class under backend/.../api/protocols/ so they agree.\n" +
      "For panel-type enum mismatches, widen the diverging surface to match the backend canonical set " +
      "(PanelType.fromString / DataPanelKinds).",
  );
  process.exit(1);
}

console.log(
  `schemas in sync with JsonProtocols (${checked.length} checked across ${sources.length} protocol files)`,
);
console.log(
  `panel-type enums in sync with backend canonical sets (${panelTypeChecked} surfaces checked)`,
);
