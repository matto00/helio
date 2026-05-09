#!/usr/bin/env node
// Verifies that JSON Schemas in `schemas/` agree with the matching
// case classes in backend/.../JsonProtocols.scala. Exits non-zero on drift.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(repoRoot, "schemas");
const protocolsPath = join(repoRoot, "backend/src/main/scala/com/helio/api/JsonProtocols.scala");

const protocolsSrc = readFileSync(protocolsPath, "utf8");

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

const classes = parseCaseClasses(protocolsSrc);

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
      `${file}: no case class "${title}" found in JsonProtocols.scala (add to SKIP set in scripts/check-schema-drift.mjs if intentional)`,
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

if (errors.length) {
  console.error("Schema/JsonProtocols drift detected:\n");
  for (const e of errors) console.error(e + "\n");
  console.error(
    "Update either the schema in schemas/ or the case class in JsonProtocols.scala so they agree.",
  );
  process.exit(1);
}

console.log(`schemas in sync with JsonProtocols.scala (${checked.length} checked)`);
