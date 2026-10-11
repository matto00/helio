import fs from "node:fs";
import path from "node:path";

import {
  COMPUTE_FUNCTION_REFERENCE,
  COMPUTE_LITERAL_REFERENCE,
  COMPUTE_OPERATOR_REFERENCE,
} from "./computeFunctionReference";

function findRepoRoot(dir: string): string {
  return fs.existsSync(path.join(dir, "shared-test-fixtures"))
    ? dir
    : findRepoRoot(path.dirname(dir));
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(findRepoRoot(__dirname), "shared-test-fixtures/compute-expression-functions.json"),
    "utf8",
  ),
) as { functions: string[]; operators: string[]; literals: string[] };

describe("compute function reference (shared fixture seam)", () => {
  it("lists exactly the functions the backend supports", () => {
    expect(COMPUTE_FUNCTION_REFERENCE.map((f) => f.name).sort()).toEqual(
      [...fixture.functions].sort(),
    );
  });

  it("lists exactly the operators and literals the backend supports", () => {
    expect(COMPUTE_OPERATOR_REFERENCE.map((o) => o.name).sort()).toEqual(
      [...fixture.operators].sort(),
    );
    expect(COMPUTE_LITERAL_REFERENCE.map((o) => o.name).sort()).toEqual(
      [...fixture.literals].sort(),
    );
  });

  it("documents if", () => {
    const entry = COMPUTE_FUNCTION_REFERENCE.find((f) => f.name === "if");
    expect(entry?.signature).toBe("if(cond, then, else)");
  });

  it("gives every operator and literal a signature and a description", () => {
    for (const op of [...COMPUTE_OPERATOR_REFERENCE, ...COMPUTE_LITERAL_REFERENCE]) {
      expect(op.signature.length).toBeGreaterThan(0);
      expect(op.description.length).toBeGreaterThan(0);
    }
  });

  it("gives every function a signature starting with its name and a description", () => {
    for (const fn of COMPUTE_FUNCTION_REFERENCE) {
      expect(fn.signature.startsWith(fn.name)).toBe(true);
      expect(fn.description.length).toBeGreaterThan(0);
    }
  });
});
