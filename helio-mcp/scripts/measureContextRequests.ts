/** HEL-1619: print request count / peak in flight / per-route counts of one `buildWorkspaceContext`
 *  call on the 55-pipeline fixture, per batched-read mode.  Run: npx tsx scripts/measureContextRequests.ts */
import { buildWorkspaceContext } from "../src/context.js";
import { createFixture, type ContextDetailsMode } from "../src/contextBudgetFixture.js";

for (const mode of ["serve", "404", "missing-one"] as ContextDetailsMode[]) {
  const fx = createFixture({ contextDetails: mode, delayMs: 5 });
  await buildWorkspaceContext(fx.api, 50_000_000, false);
  const { total, peakInFlight, byRoute } = fx.stats();
  console.log(JSON.stringify({ mode, total, peakInFlight, byRoute }));
}
