import fs from "fs";
import path from "path";

import {
  HOVER_MEDIA,
  mixedGatedRules,
  parseRules,
  stripComments,
  ungatedHoverSelectors,
  type FileRules,
} from "../test/cssHoverGating";

// HEL-1675: every stylesheet under `frontend/src/shared/` applies its hover effects only on hover-capable pointers, so a
// touch tap never leaves a shared control (IconButton, ActionsMenu, Modal buttons, Select, ...) painted hovered. Files are
// discovered by walking the directory, so a new shared stylesheet is covered with no list to update. The allowlist is
// empty on purpose: nothing under `shared/` is a hover REVEAL that must work on touch. (The pipeline page's own guard,
// `features/pipelines/ui/pipelineHoverGating.css.test.ts`, covers its stylesheets and keeps a reveal allowlist.)

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const HOVER_RULE_FLOOR = 36;

const files: FileRules[] = walk(__dirname)
  .sort()
  .map((full) => ({
    file: path.relative(__dirname, full),
    rules: parseRules(stripComments(fs.readFileSync(full, "utf-8"))),
  }));

describe("shared component hover gating (HEL-1675)", () => {
  it("walks the shared stylesheets and finds the hover rules (guard is not vacuous)", () => {
    const hovers = files.reduce(
      (n, f) => n + f.rules.filter((r) => r.selectors.some((s) => s.includes(":hover"))).length,
      0,
    );
    expect(files.length).toBeGreaterThan(15);
    expect(hovers).toBeGreaterThanOrEqual(HOVER_RULE_FLOOR);
  });

  it(`every :hover selector is inside ${HOVER_MEDIA}`, () => {
    expect(ungatedHoverSelectors(files)).toEqual([]);
  });

  it("no gated rule mixes a :hover selector with a non-hover one", () => {
    expect(mixedGatedRules(files)).toEqual([]);
  });
});
