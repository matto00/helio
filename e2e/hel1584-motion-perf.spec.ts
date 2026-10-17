import { appendFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { post, setMotion } from "./support/motionPrimitivesSeed";

// HEL-1584 D13 -- the dashboard-load and panel-drag performance proof. A 12-panel seeded dashboard under Full motion:
//   load: React commits (through __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot), CLS, long-task total and the time
//         to the first / last card whose body has real content, from a cold navigation.
//   drag: React commits, rAF frame intervals (p50 / p95 / max) over a scripted three-cell drag of one card.
// It asserts only that the measurement is sound (nothing is zero that cannot be); the numbers are compared by
// .concertino/runs/HEL-1584/evidence/perf.md. Each run appends one JSON line to $HEL1584_PERF_OUT when set.

test.use({ viewport: { width: 1440, height: 1600 } });

const PANELS = 12;

interface LoadMetrics {
  commits: number;
  cls: number;
  longTaskMs: number;
  longTasks: number;
  firstContentMs: number;
  firstVisibleMs: number;
  allVisibleMs: number;
  allContentMs: number;
  cards: number;
}
interface DragMetrics {
  commits: number;
  frames: number;
  p50: number;
  p95: number;
  max: number;
  cls: number;
}

const INIT = () => {
  const w = window as unknown as Record<string, unknown>;
  const state = {
    commits: 0,
    cls: 0,
    longTaskMs: 0,
    longTasks: 0,
    frames: [] as number[],
    recording: false,
    lastFrame: 0,
  };
  w.__perf = state;
  const hook = (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? {
    renderers: new Map(),
    supportsFiber: true,
    inject: () => 1,
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  }) as Record<string, unknown>;
  const original = hook.onCommitFiberRoot as ((...args: unknown[]) => void) | undefined;
  hook.onCommitFiberRoot = (...args: unknown[]) => {
    state.commits += 1;
    original?.(...args);
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>) {
        if (!entry.hadRecentInput) state.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTaskMs += entry.duration;
        state.longTasks += 1;
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // an unsupported entry type leaves the metric at zero; the spec's sanity check does not depend on it
  }
  // Time (performance.now origin = navigation start) to the first / last card whose body has content.
  const content = { first: -1, all: -1, cards: 0, firstVisible: -1, allVisible: -1 };
  w.__content = content;
  const hasContent = (card: Element) =>
    card.querySelector(".panel-body-skeleton") === null &&
    (card.querySelector('canvas, svg, [role="cell"], td, .metric-renderer, [class*="metric"]') !==
      null ||
      (card.textContent ?? "").trim().length > 20);
  const poll = () => {
    const cards = [...document.querySelectorAll(".panel-grid-card")];
    content.cards = cards.length;
    const ready = cards.filter(hasContent).length;
    if (content.first < 0 && ready > 0) content.first = performance.now();
    // Visible = has content AND is fully opaque (the entrance, when it plays, holds a card at opacity 0 until its turn).
    // The leaving skeleton's cards (aria-hidden, fading under the grid) are not what the user is waiting for.
    const real = cards.filter((card) => !card.closest(".crossfade__skeleton"));
    const visible = real.filter(
      (card) => hasContent(card) && Number(getComputedStyle(card).opacity) >= 0.99,
    ).length;
    if (content.firstVisible < 0 && visible > 0) content.firstVisible = performance.now();
    if (content.allVisible < 0 && real.length > 0 && visible === real.length)
      content.allVisible = performance.now();
    if (content.all < 0 && cards.length > 0 && ready === cards.length)
      content.all = performance.now();
    if (state.recording) {
      const now = performance.now();
      if (state.lastFrame > 0) state.frames.push(now - state.lastFrame);
      state.lastFrame = now;
    } else {
      state.lastFrame = 0;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

async function seed(request: Parameters<typeof post>[0]) {
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: "HEL-1584 perf source",
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "amount", type: "integer", required: true },
    ],
    rows: Array.from({ length: 40 }, (_, i) => [`R${i % 8}`, 100 + i * 13]),
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: "HEL-1584 perf pipeline",
    roots: [{ sourceId: source.id }],
  });
  const dash = await post<{ id: string }>(request, "/api/dashboards", { name: "HEL-1584 perf" });
  const kinds: Array<[string, unknown]> = [
    [
      "metric",
      { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" }, format: "integer" },
    ],
    ["chart", { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "amount" } }],
    ["table", {}],
  ];
  const panels: { id: string }[] = [];
  for (let i = 0; i < PANELS; i++) {
    const [kind, config] = kinds[i % kinds.length];
    const output = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
      kind,
      name: `perf ${kind} ${i}`,
      config,
    });
    panels.push(
      await post<{ id: string }>(request, "/api/panels", {
        dashboardId: dash.id,
        title: `Perf ${i}`,
        type: "output",
        config: { outputId: output.id },
      }),
    );
  }
  await post(request, `/api/pipelines/${pipeline.id}/run`, {});
  await post(request, `/api/dashboards/${dash.id}/auto-layout`, {
    items: panels.map((p) => ({ panelId: p.id, w: 4, h: 3 })),
  });
  return dash.id;
}

test("HEL-1584 D13 performance: cold dashboard load and a three-cell drag, 12 panels, Full motion", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(INIT);
  await registerAndLogin(page, request, {
    prefix: "hel1584p",
    displayName: "HEL-1584 perf",
    isolate: true,
  });
  await setMotion(request, "full");
  const dashboardId = await seed(request);

  // ---- cold load -------------------------------------------------------------------------------------------------
  await page.goto(`/dashboards/${dashboardId}`);
  await expect(page.locator(".panel-grid-card")).toHaveCount(PANELS, { timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __content: { all: number } }).__content.all >= 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(3_000);
  const load = await page.evaluate<LoadMetrics>(() => {
    const w = window as unknown as {
      __perf: { commits: number; cls: number; longTaskMs: number; longTasks: number };
      __content: {
        first: number;
        all: number;
        cards: number;
        firstVisible: number;
        allVisible: number;
      };
    };
    return {
      commits: w.__perf.commits,
      cls: w.__perf.cls,
      longTaskMs: w.__perf.longTaskMs,
      longTasks: w.__perf.longTasks,
      firstContentMs: w.__content.first,
      firstVisibleMs: w.__content.firstVisible,
      allVisibleMs: w.__content.allVisible,
      allContentMs: w.__content.all,
      cards: w.__content.cards,
    };
  });

  // ---- scripted drag ---------------------------------------------------------------------------------------------
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.waitForTimeout(800);
  const item = page.locator(".panel-grid > .react-grid-item").first();
  const handle = item.locator(".panel-grid-card__handle");
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = (await handle.boundingBox())!;
  const hx = box.x + box.width / 2;
  const hy = box.y + box.height / 2;
  const grid = (await page.locator(".panel-grid").boundingBox())!;
  const cell = grid.width / 12;
  await page.mouse.move(hx, hy);
  await page.evaluate(() => {
    const p = (window as unknown as { __perf: Record<string, unknown> }).__perf;
    p.commits = 0;
    p.cls = 0;
    p.frames = [];
    p.recording = true;
  });
  await page.mouse.down();
  await page.mouse.move(hx + 20, hy + 6, { steps: 4 });
  for (let step = 1; step <= 30; step++) {
    // three cells to the right and one row down, in 30 equal moves
    await page.mouse.move(hx + (3 * cell * step) / 30, hy + (40 * step) / 30);
  }
  expect(await item.getAttribute("class"), "the card is being dragged").toContain(
    "react-draggable-dragging",
  );
  await page.mouse.up();
  await page.waitForTimeout(800);
  const drag = await page.evaluate<DragMetrics>(() => {
    const p = (
      window as unknown as {
        __perf: { commits: number; cls: number; frames: number[]; recording: boolean };
      }
    ).__perf;
    p.recording = false;
    const sorted = [...p.frames].sort((a, b) => a - b);
    const q = (f: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0;
    return {
      commits: p.commits,
      cls: p.cls,
      frames: sorted.length,
      p50: q(0.5),
      p95: q(0.95),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
    };
  });

  const result = { load, drag };
  console.log(`[HEL-1584 perf] ${JSON.stringify(result)}`);
  if (process.env.HEL1584_PERF_OUT) {
    appendFileSync(process.env.HEL1584_PERF_OUT, `${JSON.stringify(result)}\n`);
  }
  expect(load.cards).toBe(PANELS);
  expect(load.commits, "React commits were counted on load").toBeGreaterThan(0);
  expect(load.firstContentMs).toBeGreaterThan(0);
  expect(drag.commits, "React commits were counted during the drag").toBeGreaterThan(0);
  expect(drag.frames, "frame intervals were recorded during the drag").toBeGreaterThan(10);
});
