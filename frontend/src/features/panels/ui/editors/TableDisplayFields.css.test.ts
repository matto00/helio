// HEL-1464 — source-text guard (NOT rendered evidence; the running-app measurement in the change's
// evidence is the proof). A long, nowrap column name must be able to shrink to the Configuration
// card at EVERY viewport width, so the shrink rules must live in the base rules, not only inside the
// phone `@media (max-width: 768px)` block (HEL-1432 had gated them there; HEL-1464 measured the
// resulting 142-232px overflow at 1024-1440px). Mutation: moving `min-width: 0` back into the media
// block turns this red.

import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.join(__dirname, "TableDisplayFields.css"), "utf-8");

/** The stylesheet with every `@media ... { ... }` block removed (i.e. the always-on rules only). */
function withoutMediaBlocks(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@media", i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, at);
    let depth = 0;
    let j = source.indexOf("{", at);
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      if (source[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

function baseRule(selector: string): string {
  const base = withoutMediaBlocks(css).replace(/\/\*[\s\S]*?\*\//g, "");
  const match = base.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no always-on rule for ${selector}`);
  return match[1];
}

describe("TableDisplayFields.css shrink rules apply at every width (HEL-1464)", () => {
  it.each([
    ".table-display-fields__row",
    ".table-display-fields__column-list-container",
    ".table-display-fields__column-row",
  ])("%s has min-width: 0 outside the phone media block", (selector) => {
    expect(baseRule(selector)).toMatch(/min-width:\s*0\s*;/);
  });

  it("the column list's track floors at zero outside the phone media block", () => {
    expect(baseRule(".table-display-fields__column-list")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
    );
  });
});
