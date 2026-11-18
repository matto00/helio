// HEL-1736 guard: the toast viewport finds the top modal through `modalDialogRegistry`, which only `Modal` writes. A
// second native dialog (a raw <dialog> element or a showModal() call) would open without registering and toasts would
// render behind it. This fails when one appears; compose `Modal` (or `BottomSheet`) instead.
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set(["shared/ui/Modal.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test") continue;
      walk(full, out);
    } else if (/\.[jt]sx?$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("native dialog guard", () => {
  it("only Modal opens native dialogs, and it imports the registry", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      const code = stripComments(readFileSync(file, "utf8"));
      if (
        !/<dialog[\s>]/.test(code) &&
        !/\.showModal\(|\[\s*["']showModal["']\s*\]|createElement\(\s*["']dialog["']/.test(code)
      )
        continue;
      if (!ALLOWED.has(rel)) offenders.push(rel);
      else expect(code).toMatch(/from "\.\/modalDialogRegistry"/);
    }
    expect(offenders).toEqual([]);
  });
});
