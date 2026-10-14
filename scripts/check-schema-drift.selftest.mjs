#!/usr/bin/env node
// Self-test for the agent-facing panel-type derivation in scripts/check-schema-drift.mjs
// (HEL-1148, design.md D6). The deliverable is a guard that stays failable: each case feeds the
// pure helpers (scripts/lib/agentFacingPanelTypes.mjs) a deliberately broken input and asserts the
// error names the offending kind/field, so a later refactor cannot quietly turn them into no-ops.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_SURFACE_EXCLUSIONS,
  deriveAgentFacingPanelTypes,
  parseKindSet,
  validateExclusions,
  validateWireExpressibility,
} from "./lib/agentFacingPanelTypes.mjs";
import {
  PANEL_KIND_ENUM_EXEMPTIONS,
  findPanelKindConstGroups,
  findPanelKindEnums,
  validatePanelKindEnumCoverage,
} from "./lib/panelKindEnumCoverage.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function includesText(errors, text) {
  return errors.some((e) => e.includes(text));
}

const canonical = ["output", "text", "markdown", "image", "divider", "form"];
const bindings = { output: "outputId", form: "dataSourceId" };

check("derivation keeps every canonical kind not in the exclusion table (form included)", () => {
  const derived = deriveAgentFacingPanelTypes(canonical, { divider: "presentational chrome" });
  assert(
    JSON.stringify(derived) === JSON.stringify(["output", "text", "markdown", "image", "form"]),
    `got ${JSON.stringify(derived)}`,
  );
});

check("the real exclusion table gives divider a stated reason and is itself valid", () => {
  assert(
    typeof AGENT_SURFACE_EXCLUSIONS.divider === "string" &&
      AGENT_SURFACE_EXCLUSIONS.divider.length > 20,
    "divider must carry a stated reason",
  );
  const errors = validateExclusions({
    canonicalKinds: canonical,
    exclusions: AGENT_SURFACE_EXCLUSIONS,
    bindings,
  });
  assert(errors.length === 0, `unexpected: ${errors.join("; ")}`);
});

check("an exclusion with an empty reason is rejected, naming the kind", () => {
  const errors = validateExclusions({
    canonicalKinds: canonical,
    exclusions: { divider: "  " },
    bindings,
  });
  assert(includesText(errors, "divider") && includesText(errors, "reason"), errors.join("; "));
});

check("a stale exclusion (no longer a canonical kind) is rejected, naming the kind", () => {
  const errors = validateExclusions({
    canonicalKinds: canonical,
    exclusions: { chart: "gone" },
    bindings,
  });
  assert(
    includesText(errors, "chart") && includesText(errors, "not a canonical"),
    errors.join("; "),
  );
});

check("an excluded kind that is output- or source-bound must be re-decided, so it fails", () => {
  for (const kind of ["form", "output"]) {
    const errors = validateExclusions({
      canonicalKinds: canonical,
      exclusions: { [kind]: "because" },
      bindings,
    });
    assert(
      includesText(errors, kind) && includesText(errors, bindings[kind]),
      `${kind}: ${errors.join("; ")}`,
    );
  }
});

check(
  "a source-bound kind whose wire field is missing from a surface fails, naming surface and field",
  () => {
    const errors = validateWireExpressibility({
      bindings,
      surfaces: [
        { label: "proposal schema", fields: new Set(["outputId"]) },
        { label: "mcp zod", fields: new Set(["outputId", "dataSourceId"]) },
      ],
    });
    assert(
      errors.length === 1 &&
        errors[0].includes("proposal schema") &&
        errors[0].includes("dataSourceId"),
      errors.join("; "),
    );
  },
);

check("wire expressibility passes when every binding field is on every surface", () => {
  const errors = validateWireExpressibility({
    bindings,
    surfaces: [{ label: "s", fields: new Set(["outputId", "dataSourceId"]) }],
  });
  assert(errors.length === 0, errors.join("; "));
});

check(
  "parseKindSet reads a Scala Set literal and fails loudly when it cannot find or parse one",
  () => {
    const src = 'private[services] val SourceBoundKinds: Set[String] = Set("form", "other")';
    const kinds = parseKindSet(src, "SourceBoundKinds", "x.scala");
    assert(JSON.stringify(kinds) === JSON.stringify(["form", "other"]), JSON.stringify(kinds));
    let threw = false;
    try {
      parseKindSet("val Nope = 1", "SourceBoundKinds", "x.scala");
    } catch (err) {
      threw = err.message.includes("SourceBoundKinds");
    }
    assert(threw, "a missing declaration must throw naming SourceBoundKinds");
    threw = false;
    try {
      parseKindSet("val SourceBoundKinds: Set[String] = Set()", "SourceBoundKinds", "x.scala");
    } catch (err) {
      threw = err.message.includes("SourceBoundKinds");
    }
    assert(threw, "an empty set must throw: it would make the expressibility check vacuous");
  },
);

check(
  "check-schema-drift.mjs hardcodes no panel-kind comparison (no form- or divider-specific exception)",
  () => {
    const src = readFileSync(join(repoRoot, "scripts/check-schema-drift.mjs"), "utf8");
    const offending = src.match(/[!=]==?\s*"(form|divider)"|"(form|divider)"\s*[!=]==?/);
    assert(!offending, `hardcoded kind comparison: ${offending?.[0]}`);
  },
);

// HEL-1412 / HEL-1149: the panel-kind enum coverage check must stay failable.
check("findPanelKindEnums finds a nested panel-kind enum and ignores a one-kind enum", () => {
  const schema = {
    properties: {
      panels: { items: { properties: { type: { enum: ["text", "markdown", "output"] } } } },
      control: { enum: ["text", "dropdown"] },
    },
  };
  const found = findPanelKindEnums(schema, canonical).map((p) => p.join("."));
  assert(
    JSON.stringify(found) === JSON.stringify(["properties.panels.items.properties.type.enum"]),
    JSON.stringify(found),
  );
});

check("an unchecked, unexempted panel-kind enum fails, naming file and path", () => {
  const errors = validatePanelKindEnumCoverage({
    detected: [{ file: "panels/new.schema.json", path: ["properties", "type", "enum"] }],
    covered: [],
    exemptions: {},
  });
  assert(
    errors.length === 1 && errors[0].includes("panels/new.schema.json#properties.type.enum"),
    errors.join("; "),
  );
});

check("a checked enum and a reason-exempted enum both pass", () => {
  const detected = [
    { file: "a.schema.json", path: ["properties", "type", "enum"] },
    { file: "b.schema.json", path: ["properties", "type", "enum"] },
  ];
  const errors = validatePanelKindEnumCoverage({
    detected,
    covered: [detected[0]],
    exemptions: { "b.schema.json#properties.type.enum": "a stated reason for the exemption" },
  });
  assert(errors.length === 0, errors.join("; "));
});

check("a reasonless, a stale, and a checked-and-exempted exemption each fail", () => {
  const detected = [{ file: "a.schema.json", path: ["properties", "type", "enum"] }];
  const key = "a.schema.json#properties.type.enum";
  const noReason = validatePanelKindEnumCoverage({
    detected,
    covered: [],
    exemptions: { [key]: "  " },
  });
  assert(includesText(noReason, "no stated reason"), noReason.join("; "));
  const stale = validatePanelKindEnumCoverage({
    detected: [],
    covered: [],
    exemptions: { "gone.schema.json#properties.type.enum": "was here once" },
  });
  assert(includesText(stale, "stale"), stale.join("; "));
  const both = validatePanelKindEnumCoverage({
    detected,
    covered: detected,
    exemptions: { [key]: "duplicate" },
  });
  assert(includesText(both, "both a checked surface and exempted"), both.join("; "));
});

// HEL-1467: panel kinds carried as per-branch `const` values under oneOf/anyOf/allOf, and
// separator-independent coverage keys.
const oneOfSchema = {
  oneOf: ["output", "text", "markdown"].map((k) => ({ properties: { type: { const: k } } })),
};

check(
  "findPanelKindConstGroups detects a oneOf per-branch const group as one wildcard path",
  () => {
    const found = findPanelKindConstGroups(oneOfSchema, canonical).map((p) => p.join("."));
    assert(
      JSON.stringify(found) === JSON.stringify(["oneOf.*.properties.type.const"]),
      JSON.stringify(found),
    );
  },
);

check("findPanelKindConstGroups detects an allOf if/then const group (create-panel shape)", () => {
  const schema = {
    allOf: ["output", "text", "form"].map((k) => ({
      if: { properties: { type: { const: k } } },
      then: { required: ["x"] },
    })),
  };
  const found = findPanelKindConstGroups(schema, canonical).map((p) => p.join("."));
  assert(
    JSON.stringify(found) === JSON.stringify(["allOf.*.if.properties.type.const"]),
    JSON.stringify(found),
  );
});

check("an unchecked, unexempted const group fails coverage, naming file and wildcard path", () => {
  const detected = findPanelKindConstGroups(oneOfSchema, canonical).map((path) => ({
    file: "panels/new.schema.json",
    path,
  }));
  const errors = validatePanelKindEnumCoverage({ detected, covered: [], exemptions: {} });
  assert(
    errors.length === 1 &&
      errors[0].includes("panels/new.schema.json#oneOf.*.properties.type.const"),
    errors.join("; "),
  );
});

check(
  "the real panel.schema.json and create-panel-request.schema.json each yield a const group",
  () => {
    for (const [file, expected] of [
      ["panels/panel.schema.json", "oneOf.*.properties.type.const"],
      ["panels/create-panel-request.schema.json", "allOf.*.if.properties.type.const"],
    ]) {
      const schema = JSON.parse(readFileSync(join(repoRoot, "schemas", file), "utf8"));
      const found = findPanelKindConstGroups(schema, canonical).map((p) => p.join("."));
      assert(found.includes(expected), `${file}: ${JSON.stringify(found)}`);
    }
  },
);

check("consts outside a combinator, and a one-kind combinator const group, are ignored", () => {
  const schema = {
    properties: {
      a: { const: "text" },
      b: { const: "output" },
      c: { properties: { type: { const: "markdown" } } },
    },
    oneOf: [
      { properties: { type: { const: "text" } } },
      { properties: { type: { const: "csv" } } },
    ],
  };
  const found = findPanelKindConstGroups(schema, canonical);
  assert(found.length === 0, JSON.stringify(found));
});

check("a nested combinator const group is reported once, by its innermost combinator", () => {
  const schema = {
    oneOf: [
      {
        anyOf: ["output", "text"].map((k) => ({ properties: { type: { const: k } } })),
      },
      { properties: { other: { const: "x" } } },
    ],
  };
  const found = findPanelKindConstGroups(schema, canonical).map((p) => p.join("."));
  assert(
    JSON.stringify(found) === JSON.stringify(["oneOf.0.anyOf.*.properties.type.const"]),
    JSON.stringify(found),
  );
});

check("a Windows-style key (panels\\x.json) matches the same surface written panels/x.json", () => {
  const path = ["properties", "type", "enum"];
  const errors = validatePanelKindEnumCoverage({
    detected: [{ file: "panels\\x.schema.json", path }],
    covered: [{ file: "panels/x.schema.json", path }],
    exemptions: {},
  });
  assert(errors.length === 0, errors.join("; "));
  const exempted = validatePanelKindEnumCoverage({
    detected: [{ file: "panels\\y.schema.json", path }],
    covered: [],
    exemptions: { "panels/y.schema.json#properties.type.enum": "a stated reason for this" },
  });
  assert(exempted.length === 0, exempted.join("; "));
});

check("the real exemption table gives every entry a reason", () => {
  for (const [key, reason] of Object.entries(PANEL_KIND_ENUM_EXEMPTIONS)) {
    assert(typeof reason === "string" && reason.trim().length > 0, `${key} has no reason`);
  }
});

check("the real script passes against the repository with form on the agent surfaces", () => {
  const run = spawnSync("node", [join(repoRoot, "scripts/check-schema-drift.mjs")], {
    encoding: "utf8",
  });
  assert(run.status === 0, `exit ${run.status}: ${run.stdout}${run.stderr}`);
});

if (failures > 0) {
  console.error(`\n${failures} check-schema-drift selftest case(s) failed`);
  process.exit(1);
}
console.log("\ncheck-schema-drift selftest: all cases passed");
