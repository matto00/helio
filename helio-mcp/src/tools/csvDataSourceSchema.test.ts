import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertExactlyOneCsvInput } from "./csvDataSourceSchema.js";

describe("assertExactlyOneCsvInput", () => {
  it("does not throw when only content is supplied", () => {
    expect(() => assertExactlyOneCsvInput("a,b\n1,2", undefined)).not.toThrow();
  });

  it("does not throw when only sourceUrl is supplied", () => {
    expect(() => assertExactlyOneCsvInput(undefined, "https://example.com/data.csv")).not.toThrow();
  });

  it("throws naming both arguments when BOTH are supplied", () => {
    expect(() => assertExactlyOneCsvInput("a,b\n1,2", "https://example.com/data.csv")).toThrow(
      /content.*sourceUrl|sourceUrl.*content/i,
    );
  });

  it("throws naming both arguments when NEITHER is supplied", () => {
    expect(() => assertExactlyOneCsvInput(undefined, undefined)).toThrow(
      /content.*sourceUrl|sourceUrl.*content/i,
    );
  });

  it("the both-supplied error explicitly states mutual exclusivity, not just presence", () => {
    expect(() => assertExactlyOneCsvInput("x", "https://example.com/data.csv")).toThrow(
      /mutually exclusive|not both/i,
    );
  });
});

/** HEL-862 task 7.3/7.2 — asserts the `create_csv_data_source` tool
 *  description's CONTENT (not merely that a description string exists):
 *  names both `content`/`sourceUrl` inputs, states the https-only rule, and
 *  does NOT describe a caller-supplied filesystem `path`. Reads `write.ts`'s
 *  SOURCE TEXT directly (never imports the module) — `write.ts`'s full
 *  ~20-tool Zod-schema surface is pathologically expensive to type-check
 *  under this repo's root tsconfig/ts-jest combination (see `write.test.ts`),
 *  so every other test in this codebase testing `write.ts`'s tools does the
 *  same narrow-extraction dance; a tool *description* has no logic to
 *  extract, so reading the raw source text is the equivalent move here. */
describe("create_csv_data_source tool description (write.ts source text)", () => {
  const writeTsPath = join(__dirname, "write.ts");
  const source = readFileSync(writeTsPath, "utf8");
  const toolStart = source.indexOf('"create_csv_data_source"');
  const toolBlock = source.slice(toolStart, source.indexOf("inputSchema: {", toolStart));

  it("names both content and sourceUrl as accepted inputs", () => {
    expect(toolBlock).toMatch(/`content`/);
    expect(toolBlock).toMatch(/`sourceUrl`/);
  });

  it("states the https-only rule", () => {
    expect(toolBlock.toLowerCase()).toMatch(/must be `https`/);
  });

  it("does NOT describe a caller-supplied filesystem path", () => {
    expect(toolBlock).toMatch(/no caller-supplied filesystem `path`/i);
  });

  it("the input schema makes content optional and adds sourceUrl as optional", () => {
    const schemaBlock = source.slice(toolStart, source.indexOf("register", toolStart));
    expect(schemaBlock).toMatch(/content:\s*z\.string\(\)\.min\(1\)\.optional\(\)/);
    expect(schemaBlock).toMatch(/sourceUrl:\s*z\.string\(\)\.min\(1\)\.optional\(\)/);
  });
});
