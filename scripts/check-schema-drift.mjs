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
// HEL-633: domain/model.scala moved to domain/model/model.scala (structural split of the
// domain/ root into model/connectors/engine/util).
const modelScala = join(repoRoot, "backend/src/main/scala/com/helio/domain/model/model.scala");
// HEL-633: services/DashboardProposalService.scala moved to services/proposals/
// (domain-named subpackage split of services/) — design.md D3.
const proposalServiceScala = join(
  repoRoot,
  "backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala",
);
const helioMcpProposalTs = join(repoRoot, "helio-mcp/src/tools/proposal.ts");
// HEL-549: DATA_PANEL_TYPES moved out of proposal.ts into its own module so a
// unit test can import the (zod-free) warning-computation logic without
// pulling proposal.ts's `server.registerTool(...)` calls into the compile
// graph — see proposalValidation.ts's docstring.
const helioMcpProposalValidationTs = join(repoRoot, "helio-mcp/src/tools/proposalValidation.ts");
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
// HEL-633: protocolsDir's contents are now split into per-domain subdirectories
// (api/protocols/<domain>/), so this must recurse — a flat readdirSync only
// sees the 3 files that stayed at the root (IdParsing/PaginationProtocol/
// ResourceProtocol).
const sources = [
  protocolsAggregator,
  ...readdirSync(protocolsDir, { recursive: true })
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
  "PanelAppearancePatch", // HEL-362: UpdatePanelRequest/PanelBatchItem.appearance is a raw
  // JsValue (mirroring `config`), decoded by PanelAppearance.Patch —
  // no matching case class to diff against.
]);

const errors = [];
const checked = [];

const allDiscoveredFiles = readdirSync(schemasDir, { recursive: true }).sort();
console.log(
  `check-schema-drift: raw recursive walk found ${allDiscoveredFiles.length} entries under ${schemasDir}`,
);

for (const file of allDiscoveredFiles) {
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

// HEL-928: widened from [a-zA-Z0-9] to also allow underscore — several assistant tool-schema
// enums (e.g. "rest_api") use snake_case values that the original alnum-only pattern silently
// dropped, which would have made the new AssistantProposalToolSchemas parity checks below
// falsely report every snake_case enum value as missing.
function extractQuoted(str) {
  return [...str.matchAll(/"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
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
// HEL-904 task 3.6: PanelType collapsed from 10 to the final 5-value set
// (output|text|markdown|image|divider) — this guard's threshold moved from
// `< 8` to `< 5` in the SAME commit as the collapse, so it still catches a
// genuinely broken/reformatted `fromString` parse without falsely failing on
// the ticket's own intended end state.
if (canonicalPanelTypes.length < 5) {
  console.error(
    `Canonical panel-type parse from ${modelScala} yielded only ${canonicalPanelTypes.length} types ` +
      `(expected >= 5) — PanelType.fromString may have been reformatted; update the parser in this script.`,
  );
  process.exit(1);
}

// Agent-facing surfaces (HEL-249/HEL-315/HEL-316) intentionally narrow the
// wire-tolerant backend set by dropping `divider` — mirroring create_panel's
// type enum in helio-mcp/src/tools/write.ts (not schema-checked). These
// surfaces are compared against this carve-out set instead of the full
// backend-canonical set.
const agentFacingPanelTypes = canonicalPanelTypes.filter((t) => t !== "divider");

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
    label: "schemas/panels/create-panel-request.schema.json properties.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "panels/create-panel-request.schema.json"), "utf8")),
      ["properties", "type", "enum"],
      "panels/create-panel-request.schema.json",
    ),
  },
  {
    label: "schemas/panels/panel.schema.json properties.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(readFileSync(join(schemasDir, "panels/panel.schema.json"), "utf8")),
      ["properties", "type", "enum"],
      "panels/panel.schema.json",
    ),
  },
  {
    label: "schemas/panels/update-panels-batch-request.schema.json panels.items.type.enum",
    canonical: canonicalPanelTypes,
    actual: getEnumAt(
      JSON.parse(
        readFileSync(join(schemasDir, "panels/update-panels-batch-request.schema.json"), "utf8"),
      ),
      ["properties", "panels", "items", "properties", "type", "enum"],
      "panels/update-panels-batch-request.schema.json",
    ),
  },
  {
    label:
      "schemas/dashboards/dashboard-proposal.schema.json $defs.ProposalPanel.properties.type.enum",
    canonical: agentFacingPanelTypes,
    actual: getEnumAt(
      JSON.parse(
        readFileSync(join(schemasDir, "dashboards/dashboard-proposal.schema.json"), "utf8"),
      ),
      ["$defs", "ProposalPanel", "properties", "type", "enum"],
      "dashboards/dashboard-proposal.schema.json",
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
  canonical: agentFacingPanelTypes,
  actual: extractQuoted(panelTypesBody),
});

const dataPanelTypeSurfaces = [
  {
    label: "helio-mcp/src/tools/proposalValidation.ts DATA_PANEL_TYPES",
    canonical: canonicalDataPanelKinds,
    actual: extractQuoted(
      extractBetween(
        readFileSync(helioMcpProposalValidationTs, "utf8"),
        "const DATA_PANEL_TYPES = new Set([",
        "])",
        helioMcpProposalValidationTs,
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

// --- AssistantProposalToolSchemas <-> tool-schema JSON Schema parity (HEL-928) ---
// AssistantProposalToolSchemas.scala hand-rolls `JsObject` trees for each `propose_*`
// ClaudeTool's `inputSchema` rather than declaring `case class`es, so the case-class scanner
// above structurally cannot see it — this file drifted from the JSON Schemas it's meant to
// mirror with nothing catching it (this whole gap is exactly what HEL-928 found: the checked-
// surface list here is a hardcoded array, not something a new tool-schema file registers itself
// into, so it's silently invisible to this gate until someone remembers to add it — the same way
// AssistantProposalToolSchemas.scala itself was). This section walks the same hand-rolled
// `JsObject(...)` literals with a paren-balanced parser and diffs their property/enum sets
// against the corresponding schemas/**/*.schema.json files (following $ref within a file's own
// $defs).
//
// HEL-928 audit of every other `.scala` file defining a `ClaudeTool` (`grep -rl "ClaudeTool(" `
// `backend/src/main/scala`): `WorkspaceAssistantTools.scala` (`find`/`get_resource`) uses a
// `ResourceTypeEnum` sourced from the internal `WorkspaceResourceType` domain enum, not from any
// `schemas/**/*.schema.json` file — there's no JSON Schema counterpart for those two tools to
// mirror, so this parity technique doesn't apply to it. Left unchecked here for that reason, not
// an oversight; `ClaudeModels.scala` only declares the `ClaudeTool` case class itself, no tool
// instances.
const assistantToolSchemasScala = join(
  repoRoot,
  "backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala",
);
// Strip `//` and `/* */` comments before parsing — naive stripping would corrupt description
// strings containing "://" (e.g. "https://dashboard.stripe.com/apikeys") or stray quotes inside
// a doc comment, so this tracks string-literal state and only treats `/` `*` as comment markers
// outside one.
function stripComments(src) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl - 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += c;
  }
  return out;
}

const assistantSrc = stripComments(readFileSync(assistantToolSchemasScala, "utf8"));

function findMatchingParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`${assistantToolSchemasScala}: unbalanced parens from index ${openIdx}`);
}

// Split a JsObject(...)'s inner body on top-level commas only — commas nested inside a
// parenthesized/bracketed value or a string literal don't count.
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      cur += c;
      if (c === "\\") cur += str[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Parse a JsObject(...) body's top-level `"key" -> <value>` entries into [key, valueSrc] pairs.
function topLevelEntries(body) {
  return splitTopLevel(body)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^"([^"]+)"\s*->\s*([\s\S]*)$/.exec(part);
      return m ? [m[1], m[2].trim()] : null;
    })
    .filter(Boolean);
}

// Extract the body of `[private] val <name>: JsObject = JsObject(...)`.
function extractValBody(name) {
  const marker = new RegExp(`val\\s+${name}\\s*:\\s*JsObject\\s*=\\s*JsObject\\(`);
  const m = marker.exec(assistantSrc);
  if (!m) throw new Error(`${assistantToolSchemasScala}: could not find "val ${name}: JsObject"`);
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = findMatchingParen(assistantSrc, openIdx);
  return assistantSrc.slice(openIdx + 1, closeIdx);
}

// Resolve a top-level `"properties" -> JsObject(...)` entry's body from a schema val's body.
function propertiesBody(valBody, name) {
  const entry = topLevelEntries(valBody).find(([k]) => k === "properties");
  if (!entry) throw new Error(`${name}: no top-level "properties" entry found`);
  const openIdx = entry[1].indexOf("(");
  return entry[1].slice(openIdx + 1, findMatchingParen(entry[1], openIdx));
}

function scalaSchemaPropertyNames(name) {
  return new Set(topLevelEntries(propertiesBody(extractValBody(name), name)).map(([k]) => k));
}

// Read the enum values off a top-level `"<field>" -> enumSchema(...)` (helper call) or
// `"<field>" -> JsObject(..., "enum" -> JsArray(...), ...)` (inline literal) property entry.
// Scoped to the matched `enumSchema(...)`/`JsArray(...)` argument list only — extractQuoted over
// the WHOLE property value would also pick up sibling keys like "type"/"description".
function scalaSchemaEnumValues(name, field) {
  const props = topLevelEntries(propertiesBody(extractValBody(name), name));
  const entry = props.find(([k]) => k === field);
  if (!entry) throw new Error(`${name}: no "${field}" property found`);
  const valueSrc = entry[1];

  const enumSchemaIdx = valueSrc.indexOf("enumSchema(");
  if (enumSchemaIdx !== -1) {
    const openIdx = enumSchemaIdx + "enumSchema".length;
    return new Set(
      extractQuoted(valueSrc.slice(openIdx + 1, findMatchingParen(valueSrc, openIdx))),
    );
  }

  const enumKeyIdx = valueSrc.indexOf('"enum"');
  if (enumKeyIdx !== -1) {
    const arrayMarkerIdx = valueSrc.indexOf("JsArray(", enumKeyIdx);
    const openIdx = arrayMarkerIdx + "JsArray".length;
    return new Set(
      extractQuoted(valueSrc.slice(openIdx + 1, findMatchingParen(valueSrc, openIdx))),
    );
  }

  throw new Error(`${name}.${field}: no enumSchema(...) or "enum" -> JsArray(...) found`);
}

// Resolve a schema file's own top-level properties, or a `$defs.<Name>` fragment's properties,
// within the SAME file (no cross-file $ref following needed for this parity check).
function jsonSchemaPropertyNames(schemaFile, defName) {
  const schema = JSON.parse(readFileSync(join(schemasDir, schemaFile), "utf8"));
  const node = defName ? schema.$defs?.[defName] : schema;
  if (!node) throw new Error(`${schemaFile}: no $defs.${defName} found`);
  return new Set(Object.keys(node.properties ?? {}));
}

function jsonSchemaEnumValues(schemaFile, defName, field) {
  const schema = JSON.parse(readFileSync(join(schemasDir, schemaFile), "utf8"));
  const node = defName ? schema.$defs?.[defName] : schema;
  const enumArr = node?.properties?.[field]?.enum;
  if (!Array.isArray(enumArr))
    throw new Error(`${schemaFile}: $defs.${defName ?? ""}.properties.${field}.enum missing`);
  return new Set(enumArr);
}

// { label, scala: [scalaVal, field?], json: [schemaFile, defName?, field?] }
// field present on both sides => compare enum values instead of property-name sets.
const assistantToolParitySurfaces = [
  {
    label: "propose_dashboard: DashboardProposalSchema <-> dashboard-proposal.schema.json",
    scala: scalaSchemaPropertyNames("DashboardProposalSchema"),
    json: jsonSchemaPropertyNames("dashboards/dashboard-proposal.schema.json"),
  },
  {
    label: "ProposalPanelSchema <-> dashboard-proposal.schema.json $defs.ProposalPanel",
    scala: scalaSchemaPropertyNames("ProposalPanelSchema"),
    json: jsonSchemaPropertyNames("dashboards/dashboard-proposal.schema.json", "ProposalPanel"),
  },
  {
    label: "ProposalPanelSchema.type enum <-> $defs.ProposalPanel.properties.type.enum",
    scala: scalaSchemaEnumValues("ProposalPanelSchema", "type"),
    json: jsonSchemaEnumValues(
      "dashboards/dashboard-proposal.schema.json",
      "ProposalPanel",
      "type",
    ),
  },
  {
    label: "propose_pipeline: PipelineProposalSchema <-> pipeline-proposal.schema.json",
    scala: scalaSchemaPropertyNames("PipelineProposalSchema"),
    json: jsonSchemaPropertyNames("pipelines/pipeline-proposal.schema.json"),
  },
  {
    label:
      "PipelineProposalSourceSchema <-> pipeline-proposal.schema.json $defs.PipelineProposalSource",
    scala: scalaSchemaPropertyNames("PipelineProposalSourceSchema"),
    json: jsonSchemaPropertyNames(
      "pipelines/pipeline-proposal.schema.json",
      "PipelineProposalSource",
    ),
  },
  {
    label:
      "PipelineProposalSourceSchema.type enum <-> $defs.PipelineProposalSource.properties.type.enum",
    scala: scalaSchemaEnumValues("PipelineProposalSourceSchema", "type"),
    json: jsonSchemaEnumValues(
      "pipelines/pipeline-proposal.schema.json",
      "PipelineProposalSource",
      "type",
    ),
  },
  {
    label: "PipelineProposalStepSchema <-> create-pipeline-transactional-step-request.schema.json",
    scala: scalaSchemaPropertyNames("PipelineProposalStepSchema"),
    json: jsonSchemaPropertyNames(
      "pipelines/create-pipeline-transactional-step-request.schema.json",
    ),
  },
  {
    label:
      "PipelineProposalOutputSchema <-> create-pipeline-transactional-output-request.schema.json",
    scala: scalaSchemaPropertyNames("PipelineProposalOutputSchema"),
    json: jsonSchemaPropertyNames(
      "pipelines/create-pipeline-transactional-output-request.schema.json",
    ),
  },
  {
    label:
      "PipelineProposalOutputSchema.kind enum <-> create-pipeline-transactional-output-request.schema.json properties.kind.enum",
    scala: scalaSchemaEnumValues("PipelineProposalOutputSchema", "kind"),
    json: new Set(
      JSON.parse(
        readFileSync(
          join(schemasDir, "pipelines/create-pipeline-transactional-output-request.schema.json"),
          "utf8",
        ),
      ).properties.kind.enum,
    ),
  },
  {
    label: "propose_combined: CombinedProposalSchema <-> combined-proposal.schema.json",
    scala: scalaSchemaPropertyNames("CombinedProposalSchema"),
    json: jsonSchemaPropertyNames("authoring/combined-proposal.schema.json"),
  },
  {
    label: "propose_patch_set: PatchSetSchema <-> patch-set.schema.json",
    scala: scalaSchemaPropertyNames("PatchSetSchema"),
    json: jsonSchemaPropertyNames("patch-sets/patch-set.schema.json"),
  },
  {
    label: "EditSchema <-> patch-set.schema.json $defs.Edit",
    scala: scalaSchemaPropertyNames("EditSchema"),
    json: jsonSchemaPropertyNames("patch-sets/patch-set.schema.json", "Edit"),
  },
  {
    label: "EditTargetSchema <-> patch-set.schema.json $defs.EditTarget",
    scala: scalaSchemaPropertyNames("EditTargetSchema"),
    json: jsonSchemaPropertyNames("patch-sets/patch-set.schema.json", "EditTarget"),
  },
  {
    label: "EditTargetSchema.kind enum <-> $defs.EditTarget.properties.kind.enum",
    scala: scalaSchemaEnumValues("EditTargetSchema", "kind"),
    json: jsonSchemaEnumValues("patch-sets/patch-set.schema.json", "EditTarget", "kind"),
  },
];

// HEL-928 turned this parity check on for the first time and it immediately found two REAL
// pre-existing drifts (verified by direct reading of both sides, not a checker false positive):
// PipelineProposalStepSchema is missing the optional `enabled` field, and EditTargetSchema's
// `kind` enum is missing `"output"`. HEL-928's author was scoped to this script only and barred
// from editing backend Scala (parallel work was in flight on Output routes/services), so these
// are narrowly allowed here — by exact surface label + exact missing value, not a blanket
// skip — rather than fixed in place. Tracked by HEL-948; remove these two entries (and this
// comment) once it ships, so this check goes back to full strict parity with zero exceptions.
const KNOWN_PRE_EXISTING_DRIFT = new Map([]);

let assistantToolSurfacesChecked = 0;
for (const { label, scala, json } of assistantToolParitySurfaces) {
  const allowed = KNOWN_PRE_EXISTING_DRIFT.get(label)?.missingInScala ?? new Set();
  const missingInScala = [...json].filter((p) => !scala.has(p) && !allowed.has(p));
  const missingInJson = [...scala].filter((p) => !json.has(p));
  if (missingInScala.length || missingInJson.length) {
    const parts = [`${label}:`];
    if (missingInScala.length)
      parts.push(
        `  in JSON Schema, missing from AssistantProposalToolSchemas.scala: ${missingInScala.join(", ")}`,
      );
    if (missingInJson.length)
      parts.push(
        `  in AssistantProposalToolSchemas.scala, missing from JSON Schema: ${missingInJson.join(", ")}`,
      );
    errors.push(parts.join("\n"));
  } else {
    assistantToolSurfacesChecked += 1;
  }
}

if (errors.length) {
  console.error("Schema/JsonProtocols drift detected:\n");
  for (const e of errors) console.error(e + "\n");
  console.error(
    "Update either the schema in schemas/ or the case class under backend/.../api/protocols/ so they agree.\n" +
      "For panel-type enum mismatches, widen the diverging surface to match the backend canonical set " +
      "(PanelType.fromString / DataPanelKinds).\n" +
      "For AssistantProposalToolSchemas.scala mismatches, update the tool's hand-rolled JsObject " +
      "schema (or the schemas/ JSON Schema it mirrors) so they agree.",
  );
  process.exit(1);
}

console.log(
  `schemas in sync with JsonProtocols (${checked.length} checked across ${sources.length} protocol files)`,
);
console.log(
  `panel-type enums in sync with backend canonical sets (${panelTypeChecked} surfaces checked)`,
);
console.log(
  `AssistantProposalToolSchemas.scala in sync with schemas/ (${assistantToolSurfacesChecked} surfaces checked)`,
);
