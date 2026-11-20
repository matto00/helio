import fs from "fs";
import path from "path";

import {
  HOVER_MEDIA,
  PIPELINE_GUARDED_FILES,
  mixedGatedRules,
  parseRules,
  stripComments,
  ungatedHoverSelectors,
  type FileRules,
} from "./test/cssHoverGating";

// HEL-1735: every other feature stylesheet under `frontend/src/` (app shell, dashboards, sources, home, panels, landing,
// ...) applies its hover effects only on hover-capable pointers, so a touch tap never leaves a feature control painted
// hovered. Together with `shared/sharedHoverGating.css.test.ts` (HEL-1675, everything under `shared/`) and
// `features/pipelines/ui/pipelineHoverGating.css.test.ts` (HEL-1668, the nine files in `PIPELINE_GUARDED_FILES`) this
// partitions every stylesheet: the walk here takes whatever those two do not, so a new stylesheet is covered with no
// list to update. A hover REVEAL (a hover that makes a control visible or reachable, not a repaint) may stay ungated
// only on the named allowlist below.

const SRC = __dirname;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const toPosix = (full: string) => path.relative(SRC, full).split(path.sep).join("/");

/** Hover REVEALS that stay ungated: `selector` is the rule's `:hover` selector at the top level (no at-rule). */
const REVEAL_ALLOWLIST: { file: string; selector: string; reason: string }[] = [
  {
    file: "features/dashboards/ui/DashboardList.css",
    selector: ".dashboard-list__item-row:hover .popover.actions-menu",
    reason:
      "HEL-1003 row actions-menu reveal, mixed with :focus-within / aria-expanded; its one render site is the " +
      "dashboards context list row (DashboardList; the Assistant conversation rows pass no onDelete and render no " +
      "actions menu); a tap focuses the row and reveals the trigger; left exactly as is",
  },
];

// A new reveal is added to the list above with its reason, never by gating a rule that makes a control reachable.
const isRevealed = (
  file: string,
  rule: { selectors: string[]; ancestors: string[] },
  selector: string,
) =>
  rule.ancestors.length === 0 &&
  REVEAL_ALLOWLIST.some((a) => a.file === file && a.selector === selector);

// Measured after the change: 110 stylesheets walked, 176 rules with a :hover selector (173 gated by this change, the reveal, 2 already gated).
const HOVER_RULE_FLOOR = 176;
const FILE_FLOOR = 110;

const guarded = new Set(PIPELINE_GUARDED_FILES);
const files: FileRules[] = walk(SRC)
  .map(toPosix)
  .filter((rel) => !rel.startsWith("shared/") && !guarded.has(rel))
  .sort()
  .map((file) => ({
    file,
    rules: parseRules(stripComments(fs.readFileSync(path.join(SRC, file), "utf-8"))),
  }));

describe("feature stylesheet hover gating (HEL-1735)", () => {
  it("walks the feature stylesheets and finds the hover rules (guard is not vacuous)", () => {
    const hovers = files.reduce(
      (n, f) => n + f.rules.filter((r) => r.selectors.some((s) => s.includes(":hover"))).length,
      0,
    );
    expect(files.length).toBeGreaterThanOrEqual(FILE_FLOOR);
    expect(hovers).toBeGreaterThanOrEqual(HOVER_RULE_FLOOR);
  });

  it("every pipeline-guarded stylesheet is a real file (a rename cannot drop it out of every guard)", () => {
    const missing = PIPELINE_GUARDED_FILES.filter((f) => !fs.existsSync(path.join(SRC, f)));
    expect(missing).toEqual([]);
  });

  it(`every :hover selector is inside ${HOVER_MEDIA} or on the named reveal allowlist`, () => {
    expect(ungatedHoverSelectors(files, isRevealed)).toEqual([]);
  });

  it("no gated rule mixes a :hover selector with a non-hover one", () => {
    expect(mixedGatedRules(files)).toEqual([]);
  });

  it("the reveal allowlist entries still exist (an entry cannot rot into a dead exemption)", () => {
    for (const entry of REVEAL_ALLOWLIST) {
      const file = files.find((f) => f.file === entry.file);
      const hit = !!file?.rules.some(
        (r) => r.ancestors.length === 0 && r.selectors.includes(entry.selector),
      );
      expect(`${entry.file} ${entry.selector} ${hit}`).toBe(`${entry.file} ${entry.selector} true`);
    }
  });
});
