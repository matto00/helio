import fs from "node:fs";
import path from "node:path";

import { COMPUTE_FUNCTION_REFERENCE } from "./computeFunctionReference";

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
) as { functions: string[] };

describe("compute function reference (shared fixture seam)", () => {
  it("lists exactly the functions the backend supports", () => {
    expect(COMPUTE_FUNCTION_REFERENCE.map((f) => f.name).sort()).toEqual(
      [...fixture.functions].sort(),
    );
  });

  it("gives every function a signature starting with its name and a description", () => {
    for (const fn of COMPUTE_FUNCTION_REFERENCE) {
      expect(fn.signature.startsWith(fn.name)).toBe(true);
      expect(fn.description.length).toBeGreaterThan(0);
    }
  });
});
