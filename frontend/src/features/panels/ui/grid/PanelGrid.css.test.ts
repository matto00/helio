import fs from "fs";
import path from "path";

// HEL-1032 / HEL-1573 (C2): the grid's timing comes from one move-duration token, and every override of the vendor
// react-grid-layout CSS wins by selector specificity, never by import order. Static assertions: jsdom evaluates no cascade.

const css = fs
  .readFileSync(path.join(__dirname, "PanelGrid.css"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const vendor = fs.readFileSync(
  path.join(__dirname, "../../../../../node_modules/react-grid-layout/css/styles.css"),
  "utf-8",
);

/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`rule not found: ${selector}`);
  return match[1];
}

/** (id, class/attribute/pseudo-class, type) specificity of a single compound-or-descendant selector. */
function specificity(selector: string): [number, number, number] {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (
    selector.replace(/\.[\w-]+|\[[^\]]+\]|:+[\w-]+|[>+~*]/g, " ").match(/\b[a-z][\w-]*\b/gi) ?? []
  ).length;
  return [0, classes, types];
}

const wins = (ours: string, theirs: string) => {
  const [, a] = specificity(ours);
  const [, b] = specificity(theirs);
  return a > b;
};

describe("PanelGrid.css reconciles the vendor grid timing (HEL-1032)", () => {
  it("times the container height, the items and the placeholder from the move token and the ease-out curve", () => {
    expect(rule(css, ".panel-grid.react-grid-layout")).toMatch(
      /transition:\s*height var\(--motion-duration-move\) var\(--motion-ease-out\)/,
    );
    const item = rule(css, ".panel-grid > .react-grid-item");
    for (const prop of ["transform", "width", "height"]) {
      expect(item).toContain(`${prop} var(--motion-duration-move) var(--motion-ease-out)`);
    }
    const placeholder = rule(css, ".panel-grid > .react-grid-item.react-grid-placeholder");
    expect(placeholder).toMatch(/transition-duration:\s*var\(--motion-duration-move\)/);
    expect(placeholder).toMatch(/transition-timing-function:\s*var\(--motion-ease-out\)/);
  });

  it("keeps the item transition list at exactly transform, width, height, the vendor cssTransforms list, in order", () => {
    const item = rule(css, ".panel-grid > .react-grid-item");
    const properties = [...item.matchAll(/(transform|width|height|left|top|all)\s+var\(/g)].map(
      (m) => m[1],
    );
    expect(properties).toEqual(["transform", "width", "height"]);
    expect(rule(vendor, ".react-grid-item.cssTransforms")).toMatch(
      /transition-property:\s*transform, width, height/,
    );
  });

  it("outranks each vendor timing rule by specificity", () => {
    expect(wins(".panel-grid.react-grid-layout", ".react-grid-layout")).toBe(true);
    expect(wins(".panel-grid > .react-grid-item", ".react-grid-item")).toBe(true);
    expect(
      wins(
        ".panel-grid > .react-grid-item.react-grid-placeholder",
        ".react-grid-item.react-grid-placeholder",
      ),
    ).toBe(true);
  });

  it("re-asserts every vendor transition:none state above the timing rules that would otherwise tie or win", () => {
    const vendorNone = [...vendor.matchAll(/([^{}]+)\{[^}]*transition:\s*none/g)].map((m) =>
      m[1].trim(),
    );
    expect(vendorNone.sort()).toEqual(
      [
        ".react-grid-item.react-draggable-dragging",
        ".react-grid-item.react-grid-placeholder.placeholder-resizing",
        ".react-grid-item.resizing",
      ].sort(),
    );
    const item = ".panel-grid > .react-grid-item";
    const placeholderTiming = ".panel-grid > .react-grid-item.react-grid-placeholder";
    for (const [none, timing] of [
      [".panel-grid > .react-grid-item.react-draggable-dragging", item],
      [".panel-grid > .react-grid-item.resizing", item],
      [
        ".panel-grid > .react-grid-item.react-grid-placeholder.placeholder-resizing",
        placeholderTiming,
      ],
    ]) {
      expect(css).toMatch(
        new RegExp(`${none.replace(/[.>]/g, "\\$&")}[^{]*\\{[^}]*transition:\\s*none`),
      );
      expect(wins(none, timing)).toBe(true);
    }
  });

  it("carries no literal duration", () => {
    expect(css).not.toMatch(/\b\d*\.?\d+m?s\b/);
  });
});
