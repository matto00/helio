/**
 * GUARD (HEL-1160) -- every `${...}` inside an `/api/` request-path template in helio-mcp/src must be a
 * `pathSegment(...)` call. A static scan: it fails when a raw id is interpolated into a path.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = __dirname;
const EXCLUDED_DIRS = new Set(["testing", "__golden__"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return EXCLUDED_DIRS.has(name) ? [] : sourceFiles(full);
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) return [];
    if (name === "contextBudgetFixture.ts") return [];
    return [full];
  });
}

/** Template literals whose text starts with `/api/` (no nested backticks inside the expressions). */
const TEMPLATE = /`\/api\/[^`]*`/g;

function expressions(template: string): string[] {
  const out: string[] = [];
  const re = /\$\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    let depth = 1;
    let i = m.index + 2;
    while (i < template.length && depth > 0) {
      if (template[i] === "{") depth++;
      else if (template[i] === "}") depth--;
      i++;
    }
    out.push(template.slice(m.index + 2, i - 1).trim());
  }
  return out;
}

// Measured after implementation (62 helioApi + 1 familyClient).
const MIN_SITES = 63;

describe("GUARD: request paths interpolate only pathSegment(...)", () => {
  const found = sourceFiles(SRC).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(TEMPLATE)].flatMap((t) =>
      expressions(t[0]).map((expr) => ({ file: path.relative(SRC, file), expr })),
    ),
  );

  it("scans enough sites to not be vacuous", () => {
    expect(found.length).toBeGreaterThanOrEqual(MIN_SITES);
    expect(found.length).toBeGreaterThan(0);
  });

  it("has no raw interpolation in an /api/ template", () => {
    const raw = found.filter((f) => !f.expr.startsWith("pathSegment("));
    expect(raw).toEqual([]);
  });
});
