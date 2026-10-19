import fs from "fs";
import path from "path";

// HEL-1668 D5: the pipeline page's own stylesheets apply hover FILLS only on hover-capable pointers, so a touch tap
// never leaves a hover fill stuck. Every selector containing `:hover` is either inside `@media (hover: hover)` or on
// the named reveal allowlist below; and no gated rule mixes a `:hover` selector with a non-hover one (a mixed list
// would either un-gate the non-hover state or drag it into the gate).

const FILES = [
  "PipelineDetailPage.css",
  "StepCardFocused.css",
  "OutputSchemaDisclosure.css",
  "mobile/PipelineMobile.css",
  "spine/PipelineSpine.css",
  "spine/PipelineSpineAccent.css",
  "spine/PipelineSpineHeader.css",
  "spine/PipelineSpineLayout.css",
  "spine/StepPreviewTable.css",
];

const HOVER_MEDIA = "@media (hover: hover)";
const COMPACT_CONTAINER = "@container spine-column (max-width: 226px)";

/** Hover REVEALS (not fills) that stay ungated, each with its reason. A tap on a touch device has to keep revealing
 *  these (and, for the compact block, keep the tapped row's tones), so gating them would make a control unreachable or
 *  change HEL-1608's touch-tablet behaviour. */
const REVEAL_ALLOWLIST: { file: string; ancestor?: string; selector: string; reason: string }[] = [
  {
    file: "spine/PipelineSpine.css",
    selector: ".spine-row:hover .spine-row__grip",
    reason: "drag-grip reveal; dragging is pointer-only, so showing the grip on a tap is harmless",
  },
  {
    file: "spine/PipelineSpine.css",
    selector: ".spine-row:hover .spine-row__menu",
    reason:
      "regular-spine row-menu opacity reveal, mixed with :focus-within / selected; left exactly as is",
  },
  {
    file: "spine/PipelineSpine.css",
    ancestor: COMPACT_CONTAINER,
    selector: "*",
    reason:
      "HEL-1608 compact-mode block as ONE unit: on a touch tablet a tap reveals the row menu, and gating only its " +
      "selected-row tones would turn the tapped row from accent to grey",
  },
];

interface Rule {
  selectors: string[];
  ancestors: string[];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTop(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of selector) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter((p) => p !== "");
}

function parseRules(css: string, ancestors: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const prelude = css
      .slice(i, open)
      .replace(/^[\s;}]+/, "")
      .trim();
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) {
      const normalized = prelude.replace(/\s+/g, " ");
      if (/^@(media|supports|container|layer)/.test(normalized)) {
        rules.push(...parseRules(body, [...ancestors, normalized]));
      }
    } else {
      rules.push({ selectors: splitTop(prelude.replace(/\s+/g, " ")), ancestors });
    }
    i = j;
  }
  return rules;
}

const rulesByFile = FILES.map((file) => ({
  file,
  rules: parseRules(stripComments(fs.readFileSync(path.join(__dirname, file), "utf-8"))),
}));

describe("pipeline page hover gating (HEL-1668)", () => {
  it("parses a plausible number of hover rules (guard is not vacuous)", () => {
    const hovers = rulesByFile.flatMap((f) =>
      f.rules.filter((r) => r.selectors.some((s) => s.includes(":hover"))),
    );
    expect(hovers.length).toBeGreaterThan(40);
  });

  it("every :hover selector is inside @media (hover: hover) or on the named reveal allowlist", () => {
    const offenders: string[] = [];
    for (const { file, rules } of rulesByFile) {
      for (const rule of rules) {
        for (const selector of rule.selectors.filter((s) => s.includes(":hover"))) {
          if (rule.ancestors.includes(HOVER_MEDIA)) continue;
          const allowed = REVEAL_ALLOWLIST.some(
            (a) =>
              a.file === file &&
              (a.ancestor === undefined
                ? rule.ancestors.length === 0 && a.selector === selector
                : rule.ancestors.includes(a.ancestor)),
          );
          if (!allowed) offenders.push(`${file}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no gated rule mixes a :hover selector with a non-hover one", () => {
    const mixed: string[] = [];
    for (const { file, rules } of rulesByFile) {
      for (const rule of rules) {
        if (!rule.ancestors.includes(HOVER_MEDIA)) continue;
        if (rule.selectors.some((s) => !s.includes(":hover")))
          mixed.push(`${file}: ${rule.selectors.join(", ")}`);
      }
    }
    expect(mixed).toEqual([]);
  });

  it("the reveal allowlist units still exist (an entry cannot rot into dead exemption)", () => {
    for (const entry of REVEAL_ALLOWLIST) {
      const file = rulesByFile.find((f) => f.file === entry.file)!;
      const hit = file.rules.some((r) =>
        entry.ancestor === undefined
          ? r.ancestors.length === 0 && r.selectors.includes(entry.selector)
          : r.ancestors.includes(entry.ancestor) && r.selectors.some((s) => s.includes(":hover")),
      );
      expect(`${entry.file} ${entry.selector} ${hit}`).toBe(`${entry.file} ${entry.selector} true`);
    }
  });
});
