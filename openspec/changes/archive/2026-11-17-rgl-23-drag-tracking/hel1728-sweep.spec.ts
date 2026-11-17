// HEL-1728 scratch timing sweep (NOT committed under e2e/; copied there only while running, then removed).
// Run: SWEEP_OUT=<dir> DEV_PORT=<port> npx playwright test e2e/hel1728-sweep.spec.ts --workers 1
// Drives the real panel grid with CDP (trusted) mouse input via page.mouse; stands in for a physical mouse.
import { mkdirSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { seedWorld, setMotion } from "./support/motionPrimitivesSeed";
import { waitForPanelGrid } from "./support/panelGridReady";

test.use({ viewport: { width: 1900, height: 1000 } });

const OUT = process.env.SWEEP_OUT ?? "/tmp/hel1728-sweep";
const REPS = Number(process.env.SWEEP_REPS ?? 5);
const DELAYS = [0, 8, 16, 33, 100];
const TOL = 30;
// Each row runs as its own invocation (own user): ~50 page loads in one session trips the /api rate limit and logs the page out.
const ONLY = process.env.SWEEP_ONLY ?? ""; // one of d0,d8,d16,d33,d100,control,r0,r16
const want = (k: string) => ONLY === "" || ONLY === k;

type Row = { row: string; reps: number; pass: number; diffs: number[] };

test("HEL-1728 drag/resize timing sweep", async ({ page, request }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  await registerAndLogin(page, request, {
    prefix: "hel1728",
    displayName: "HEL-1728",
    label: "sweep",
    isolate: true,
  });
  await setMotion(request, "full");
  const world = await seedWorld(request, "M-sweep");

  const open = async () => {
    await page.goto(`/dashboards/${world.dashboardId}`);
    await waitForPanelGrid(page, 3);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Edit layout" }).click();
    const metric = page
      .locator(".panel-grid > .react-grid-item")
      .filter({ hasText: "M-sweep Metric" });
    const probe = () =>
      metric.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, width: r.width };
      });
    return { metric, probe };
  };

  const rows: Row[] = [];
  const record = (row: string, diffs: number[], passes: boolean[]) =>
    rows.push({ row, reps: diffs.length, pass: passes.filter(Boolean).length, diffs });

  // Delay sweep: down, wait `delay`, then 8ms-interval moves over ~1s / 400px.
  for (const delay of DELAYS) {
    if (!want(`d${delay}`)) continue;
    const diffs: number[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const { metric, probe } = await open();
      const start = await probe();
      const hb = (await metric.locator(".panel-grid-card__handle").boundingBox())!;
      const hx = hb.x + hb.width / 2;
      const hy = hb.y + hb.height / 2;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      if (delay > 0) await page.waitForTimeout(delay);
      const N = 125;
      for (let i = 1; i <= N; i++) {
        await page.mouse.move(hx + (400 * i) / N, hy + (10 * i) / N);
        await page.waitForTimeout(8);
      }
      await page.waitForTimeout(60);
      const now = await probe();
      diffs.push(Math.abs(now.left - start.left - 400));
      if (delay === 100 && rep === 0) {
        for (const theme of ["light", "dark"]) {
          await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/drag-held-${theme}.png` });
        }
      }
      await page.mouse.up();
    }
    record(`drag delay=${delay}ms`, diffs, diffs.map((d) => d < TOL));
  }

  // Control row: the hel1573:275 sequence verbatim.
  if (want("control")) {
    const diffs: number[] = [];
    const passes: boolean[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const { metric, probe } = await open();
      const start = await probe();
      const hb = (await metric.locator(".panel-grid-card__handle").boundingBox())!;
      const hx = hb.x + hb.width / 2;
      const hy = hb.y + hb.height / 2;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.mouse.move(hx + 40, hy + 10, { steps: 4 });
      let worst = 0;
      for (const dx of [120, 260, 420]) {
        await page.mouse.move(hx + dx, hy + 10, { steps: 6 });
        await page.waitForTimeout(60);
        const now = await probe();
        worst = Math.max(worst, Math.abs(now.left - start.left - dx));
      }
      diffs.push(worst);
      passes.push(worst < TOL);
      await page.mouse.up();
    }
    record("control: hel1573:275 drag sequence", diffs, passes);
  }

  // Resize via the SE handle at 0 and 16ms.
  for (const delay of [0, 16]) {
    if (!want(`r${delay}`)) continue;
    const diffs: number[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const { metric, probe } = await open();
      const w0 = (await probe()).width;
      const rh = (await metric.locator(".react-resizable-handle-se").boundingBox())!;
      const rx = rh.x + rh.width / 2;
      const ry = rh.y + rh.height / 2;
      await page.mouse.move(rx, ry);
      await page.mouse.down();
      if (delay > 0) await page.waitForTimeout(delay);
      const N = 60;
      for (let i = 1; i <= N; i++) {
        await page.mouse.move(rx + (300 * i) / N, ry);
        await page.waitForTimeout(8);
      }
      await page.waitForTimeout(60);
      const now = await probe();
      diffs.push(Math.abs(now.width - w0 - 300));
      await page.mouse.up();
    }
    record(`resize delay=${delay}ms`, diffs, diffs.map((d) => d < 40));
  }

  writeFileSync(`${OUT}/sweep-result-${ONLY || "all"}.json`, JSON.stringify(rows, null, 2));
  console.log("SWEEP " + JSON.stringify(rows));
});
