/**
 * HEL-1619 task 2.0: capture the golden `buildWorkspaceContext` output (full + concise, with
 * `generatedAt` stripped) from the 55-pipeline fixture. The committed goldens were produced by the
 * PRE-change `context.ts`; re-running this against the new code only to "refresh" them defeats the
 * byte-identical proof, so do that only when the fixture itself intentionally changes.
 *
 * Run (from helio-mcp/):  npx tsx scripts/captureContextGolden.ts
 */
import { writeFileSync } from "node:fs";
import { buildWorkspaceContext } from "../src/context.js";
import { createFixture, stripGeneratedAt } from "../src/contextBudgetFixture.js";

const out = (name: string) => new URL(`../src/__golden__/${name}`, import.meta.url);

// A budget far above the fixture's size so `applyBudget` never truncates the full golden.
const full = await buildWorkspaceContext(
  createFixture({ contextDetails: "404" }).api,
  50_000_000,
  false,
);
const concise = await buildWorkspaceContext(
  createFixture({ contextDetails: "404" }).api,
  50_000_000,
  true,
);
writeFileSync(
  out("workspaceContext.full.json"),
  JSON.stringify(stripGeneratedAt(full), null, 1) + "\n",
);
writeFileSync(
  out("workspaceContext.concise.json"),
  JSON.stringify(stripGeneratedAt(concise), null, 1) + "\n",
);
console.log("golden written");
