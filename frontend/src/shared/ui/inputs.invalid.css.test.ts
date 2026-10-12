import fs from "fs";
import path from "path";

// HEL-1490 item 6 -- the shared Select trigger carries `aria-invalid` (Select.tsx) but showed no visual invalid
// state. jest maps CSS to a stub, so this reads the source: the Select trigger must share the .ui-input invalid
// recipe (error border always; error halo while focus-visible), with hover parity left unchanged.
const css = fs
  .readFileSync(path.join(__dirname, "inputs.css"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector: string): string | undefined {
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const list = m[1].split(",").map((s) => s.trim());
    if (list.includes(selector)) return m[2];
  }
  return undefined;
}

describe("shared Select invalid state", () => {
  it("gives the invalid trigger the --app-error border", () => {
    expect(ruleFor('.ui-select__trigger[aria-invalid="true"]')).toMatch(
      /border-color:\s*var\(--app-error\);/,
    );
  });

  it("gives the focused invalid trigger the --app-error-surface halo", () => {
    const body = ruleFor('.ui-select__trigger[aria-invalid="true"]:focus-visible');
    expect(body).toMatch(/border-color:\s*var\(--app-error\);/);
    expect(body).toMatch(/box-shadow:\s*0 0 0 3px var\(--app-error-surface\);/);
  });

  it("keeps the text input recipe it mirrors", () => {
    expect(ruleFor('.ui-input[aria-invalid="true"]')).toMatch(
      /border-color:\s*var\(--app-error\);/,
    );
  });
});
