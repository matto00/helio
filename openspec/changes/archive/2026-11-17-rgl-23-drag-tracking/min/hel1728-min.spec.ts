// HEL-1728 D5: run the same pointer sequences against the minimal page (no app code, no login).
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "@playwright/test";

test.use({ viewport: { width: 1400, height: 900 } });
const OUT = process.env.SWEEP_OUT ?? "/tmp/hel1728-min";
const REPS = Number(process.env.SWEEP_REPS ?? 5);
const QUERY = process.env.MIN_QUERY ?? "";
const DELAYS = [0, 8, 16, 33, 100];

test("HEL-1728 minimal-page sweep", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const rows: { row: string; reps: number; pass: number; diffs: number[] }[] = [];
  const open = async () => {
    await page.goto(`/hel1728-min.html${QUERY ? "?" + QUERY : ""}`);
    const item = page.locator('.react-grid-item[data-k="a"], .react-grid-item:has([data-k="a"]), .react-grid-item').first();
    page.on("pageerror", (e) => console.log("PAGEERROR " + e.message.slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR " + m.text().slice(0, 300)); });
    await item.waitFor({ timeout: 15000 });
    const probe = () => item.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width }; });
    return { item, probe };
  };
  const drag = async (delay: number | "control") => {
    const diffs: number[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const { item, probe } = await open();
      const s = await probe();
      const hb = (await item.locator(".h").boundingBox())!;
      const hx = hb.x + hb.width / 2, hy = hb.y + hb.height / 2;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      if (delay === "control") {
        await page.mouse.move(hx + 40, hy + 10, { steps: 4 });
        let worst = 0;
        for (const dx of [120, 260, 420]) {
          await page.mouse.move(hx + dx, hy + 10, { steps: 6 });
          await page.waitForTimeout(60);
          worst = Math.max(worst, Math.abs((await probe()).left - s.left - dx));
        }
        diffs.push(worst);
      } else {
        if (delay > 0) await page.waitForTimeout(delay);
        for (let i = 1; i <= 125; i++) { await page.mouse.move(hx + (400 * i) / 125, hy + (10 * i) / 125); await page.waitForTimeout(8); }
        await page.waitForTimeout(60);
        diffs.push(Math.abs((await probe()).left - s.left - 400));
      }
      await page.mouse.up();
    }
    rows.push({ row: delay === "control" ? "control: hel1573:275 drag sequence" : `drag delay=${delay}ms`, reps: REPS, pass: diffs.filter((d) => d < 30).length, diffs });
  };
  await drag("control");
  for (const d of DELAYS) await drag(d);
  for (const delay of [0, 16]) {
    const diffs: number[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const { item, probe } = await open();
      const w0 = (await probe()).width;
      const rh = (await item.locator(".react-resizable-handle-se").boundingBox())!;
      const rx = rh.x + rh.width / 2, ry = rh.y + rh.height / 2;
      await page.mouse.move(rx, ry);
      await page.mouse.down();
      if (delay > 0) await page.waitForTimeout(delay);
      for (let i = 1; i <= 60; i++) { await page.mouse.move(rx + (300 * i) / 60, ry); await page.waitForTimeout(8); }
      await page.waitForTimeout(60);
      diffs.push(Math.abs((await probe()).width - w0 - 300));
      await page.mouse.up();
    }
    rows.push({ row: `resize delay=${delay}ms`, reps: REPS, pass: diffs.filter((d) => d < 40).length, diffs });
  }
  writeFileSync(`${OUT}/min-result-${QUERY || "bare"}.json`, JSON.stringify(rows, null, 2));
  console.log("MINSWEEP " + JSON.stringify(rows));
});
