import fs from "fs";
import path from "path";

// HEL-1191 (owner ruling, HEL-588 "Action in Inspect", 2026-09-25) — a chart click opens Inspect
// only; ONLY `PanelInspectView`'s explicit "Filter dashboard by X = Y" action dispatches
// `setCrossFilter`. This ticket changes how the filter is APPLIED, never how it is triggered, so
// no other production module may reference the action creator or its type string.

const SRC_ROOT = path.resolve(__dirname, "../../..");

function productionSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    if (full.includes(`${path.sep}test${path.sep}`)) return [];
    return [full];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("cross-filter trigger flow (HEL-1191)", () => {
  const referencing = productionSourceFiles(SRC_ROOT)
    .filter((file) =>
      /\bsetCrossFilter\b|panels\/setCrossFilter/.test(
        stripComments(fs.readFileSync(file, "utf8")),
      ),
    )
    .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
    .sort();

  it("only the slice (definition) and PanelInspectView reference setCrossFilter", () => {
    expect(referencing).toEqual([
      "features/panels/state/panelsSlice.ts",
      "features/panels/ui/PanelInspectView.tsx",
    ]);
  });

  it("PanelInspectView is the dispatcher", () => {
    const inspect = fs.readFileSync(
      path.join(SRC_ROOT, "features/panels/ui/PanelInspectView.tsx"),
      "utf8",
    );
    expect(stripComments(inspect)).toMatch(/dispatch\(setCrossFilter\(/);
  });
});
