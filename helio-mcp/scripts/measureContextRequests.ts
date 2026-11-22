/** HEL-1619 / HEL-1625: print request count / peak in flight / per-route counts of one `buildWorkspaceContext`
 *  call on the 55-pipeline fixture, per batched-read mode, and at 200 pipelines.
 *  Run: npx tsx scripts/measureContextRequests.ts */
import { buildWorkspaceContext } from "../src/context.js";
import {
  createFixture,
  type ContextAnalyzeMode,
  type ContextDetailsMode,
} from "../src/contextBudgetFixture.js";

const cases: Array<{
  contextDetails: ContextDetailsMode;
  contextAnalyze: ContextAnalyzeMode;
  pipelines?: number;
  placedBelow?: number;
}> = [
  { contextDetails: "serve", contextAnalyze: "serve" },
  { contextDetails: "serve", contextAnalyze: "404" },
  { contextDetails: "404", contextAnalyze: "serve" },
  { contextDetails: "serve", contextAnalyze: "missing-one" },
  { contextDetails: "serve", contextAnalyze: "serve", pipelines: 200, placedBelow: 55 },
  { contextDetails: "serve", contextAnalyze: "404", pipelines: 200, placedBelow: 55 },
];
for (const c of cases) {
  const fx = createFixture({ ...c, delayMs: 5 });
  await buildWorkspaceContext(fx.api, 50_000_000, false);
  const { total, peakInFlight, byRoute } = fx.stats();
  console.log(JSON.stringify({ ...c, total, peakInFlight, byRoute }));
}
