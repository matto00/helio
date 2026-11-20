import fs from "fs";
import path from "path";

import {
  PIPELINE_GUARDED_FILES,
  mixedGatedRules,
  parseRules,
  stripComments,
  ungatedHoverSelectors,
} from "../../../test/cssHoverGating";

// HEL-1668 D5: the pipeline page's own stylesheets apply hover FILLS only on hover-capable pointers, so a touch tap
// never leaves a hover fill stuck. Every selector containing `:hover` is either inside `@media (hover: hover)` or on
// the named reveal allowlist below; and no gated rule mixes a `:hover` selector with a non-hover one (a mixed list
// would either un-gate the non-hover state or drag it into the gate).

const SRC = path.join(__dirname, "..", "..", "..");
// Shared with the feature-wide guard (`featureHoverGating.css.test.ts`), which excludes exactly these files. Each entry is
// re-relativized to this directory so `FileRules.file` and the allowlist below keep their short form.
const FILES = PIPELINE_GUARDED_FILES.map((f) => path.relative(__dirname, path.join(SRC, f)));

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
    const offenders = ungatedHoverSelectors(rulesByFile, (file, rule, selector) =>
      REVEAL_ALLOWLIST.some(
        (a) =>
          a.file === file &&
          (a.ancestor === undefined
            ? rule.ancestors.length === 0 && a.selector === selector
            : rule.ancestors.includes(a.ancestor)),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("no gated rule mixes a :hover selector with a non-hover one", () => {
    const mixed = mixedGatedRules(rulesByFile);
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
