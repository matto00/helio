// HEL-1839 GUARD (not a behavior test): a source-pattern check over the pipeline feature's non-test sources. It catches a
// fail-open role default (`canEdit = true`, `canRun = true`, `editable = true`, `isOwner = true`, `readOnly = false`) and an
// optional role prop that no fail-closed default backs. It cannot see behavior; the per-component behavior proof is
// `ui/failClosedRoleDefaults.test.tsx`. The scanner is exercised on planted source below, so the guard itself is failable.
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const ROOT = __dirname;

const FAIL_OPEN = /\b(canEdit|canRun|editable|isOwner)\s*=\s*true\b|\breadOnly\s*=\s*false\b/;
const OPTIONAL_ROLE_PROP = /\b(readOnly|canEdit|canRun|isOwner|runRole)\?:/g;
const FAIL_CLOSED_DEFAULT: Record<string, RegExp> = {
  readOnly: /\breadOnly\s*=\s*true\b/,
  canEdit: /\bcanEdit\s*=\s*false\b/,
  canRun: /\bcanRun\s*=\s*false\b/,
  isOwner: /\bisOwner\s*=\s*false\b/,
};

/** A types-only file declares an optional prop whose default lives in the component that consumes it. Explicit map, one
 *  entry per file: never "a default anywhere in the feature". */
const DEFAULT_LIVES_IN: Record<string, string> = {
  "ui/stepCardTypes.ts": "ui/StepCardFocused.tsx",
};

export function violationsIn(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    if (FAIL_OPEN.test(source)) out.push(`${path}: fail-open default`);
    const owner = DEFAULT_LIVES_IN[path];
    const defaultsIn = owner === undefined ? source : (files[owner] ?? "");
    for (const m of source.matchAll(OPTIONAL_ROLE_PROP)) {
      const prop = m[1]!;
      // `runRole` is a data-layer input: required, never defaulted.
      if (prop === "runRole" || !FAIL_CLOSED_DEFAULT[prop]!.test(defaultsIn)) {
        out.push(`${path}: optional \`${prop}\` has no fail-closed default`);
      }
    }
  }
  return out;
}

function sourcesUnder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      Object.assign(out, sourcesUnder(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out[relative(ROOT, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  }
  return out;
}

describe("role defaults are fail-closed across features/pipelines (guard, HEL-1839)", () => {
  it("the real sources have no fail-open default and no undefaulted optional role prop", () => {
    const files = sourcesUnder(ROOT);
    expect(Object.keys(files).length).toBeGreaterThan(100);
    expect(violationsIn(files)).toEqual([]);
  });

  describe("the scanner itself reports each planted pattern", () => {
    it.each([
      ["canEdit = true", "function F({ canEdit = true }: P) {}"],
      ["canRun = true", "function F({ canRun = true }: P) {}"],
      ["editable = true", "function F({ editable = true }: P) {}"],
      ["isOwner = true", "function F({ isOwner = true }: P) {}"],
      ["readOnly = false", "function F({ readOnly = false }: P) {}"],
    ])("fail-open default %s", (_label, source) => {
      expect(violationsIn({ "ui/X.tsx": source })).toEqual(["ui/X.tsx: fail-open default"]);
    });

    it("an optional role prop with no default, and a runRole that is optional at all", () => {
      expect(violationsIn({ "ui/X.tsx": "interface P { readOnly?: boolean }" })).toHaveLength(1);
      expect(violationsIn({ "hooks/h.ts": "interface A { runRole?: R }" })).toHaveLength(1);
      expect(
        violationsIn({
          "ui/X.tsx": "interface P { canEdit?: boolean } function F({ canEdit = false }: P) {}",
        }),
      ).toEqual([]);
    });

    it("an interface file is backed only by its mapped consumer, not by a default elsewhere", () => {
      const types = "interface P { readOnly?: boolean }";
      expect(
        violationsIn({
          "ui/stepCardTypes.ts": types,
          "ui/StepCardFocused.tsx": "({ readOnly = true })",
        }),
      ).toEqual([]);
      expect(
        violationsIn({
          "ui/stepCardTypes.ts": types,
          "ui/StepCardFocused.tsx": "({ x })",
          "ui/Y.tsx": "({ readOnly = true })",
        }),
      ).toHaveLength(1);
    });
  });
});
