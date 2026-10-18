// Shared probes for the HEL-1668 e2e specs: the steps of a seeded pipeline and the page-side frame/DOM recorder that
// proves a toast's live region was connected and empty for whole rendered frames before its message was inserted.

import { expect, type Locator, type Page } from "@playwright/test";

export const CSRF = { "X-Helio-Requested-With": "1" };

export interface StepRef {
  id: string;
  type: string;
}

/** The pipeline's steps in position order, from the API (the deep link names a step by id). */
export async function stepsOf(page: Page, pipelineId: string): Promise<StepRef[]> {
  const res = await page.request.get(`/api/pipelines/${pipelineId}/steps`);
  expect(res.status()).toBe(200);
  return (await res.json()) as StepRef[];
}

/** Installs, before any page script runs: a rAF-driven frame counter (its rAF is registered first, so it increments
 *  before any later rAF callback of the same frame) and a MutationObserver logging every live-region connection and
 *  message insertion with the counter at that moment. Read back with `readAlertLog`. */
export async function installFrameRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __frames: number;
      __alertLog: Record<string, unknown>[];
    };
    w.__frames = 0;
    w.__alertLog = [];
    const tick = () => {
      w.__frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const connectedAt = new WeakMap<Element, number>();
    const regionsIn = (node: Node): Element[] => {
      if (!(node instanceof Element)) return [];
      return [
        ...(node.matches('[role="alert"]') ? [node] : []),
        ...Array.from(node.querySelectorAll('[role="alert"]')),
      ];
    };
    const start = () => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const added of Array.from(record.addedNodes)) {
            for (const region of regionsIn(added)) {
              connectedAt.set(region, w.__frames);
              w.__alertLog.push({
                kind: "region",
                frame: w.__frames,
                inDialog: region.closest("dialog") !== null,
                empty: region.childElementCount === 0 && (region.textContent ?? "") === "",
              });
            }
            const region =
              record.target instanceof Element ? record.target.closest('[role="alert"]') : null;
            if (region && (added.textContent ?? "") !== "") {
              w.__alertLog.push({
                kind: "message",
                text: added.textContent,
                frame: w.__frames,
                gap: w.__frames - (connectedAt.get(region) ?? -1000),
                inDialog: region.closest("dialog") !== null,
                blockedAncestor: region.closest('[inert],[aria-hidden="true"]') !== null,
              });
            }
          }
        }
      }).observe(document, { subtree: true, childList: true });
    };
    start();
  });
}

export interface AlertLogEntry {
  kind: "region" | "message";
  frame: number;
  inDialog: boolean;
  empty?: boolean;
  gap?: number;
  text?: string;
  blockedAncestor?: boolean;
}

export const readAlertLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __alertLog: AlertLogEntry[] }).__alertLog);

/** A pipeline whose source has `columns` columns (with long names (the schema panel caps a group at 20 chips, so only long chips make it tall: more content than
 *  its 24rem cap)), one filter step and one Output. Returns the pipeline id. */
export async function seedTallSchemaPipeline(page: Page, columns = 24): Promise<string> {
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const names = Array.from(
    { length: columns },
    (_, i) => `a_deliberately_long_column_name_number_${String(i + 1).padStart(2, "0")}`,
  );
  const source = await post<{ id: string }>("/api/data-sources", {
    name: "hel1668-tall-src",
    type: "static",
    columns: names.map((name) => ({ name, type: "integer" })),
    rows: [names.map((_, i) => i), names.map((_, i) => i + 1)],
  });
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "hel1668-tall-pipe",
    roots: [{ sourceId: source.id }],
  });
  const filter = await post<{ id: string }>(`/api/pipelines/${pipeline.id}/steps`, {
    type: "filter",
    config: {
      combinator: "and",
      conditions: [{ field: names[0], operator: ">=", value: "0" }],
    },
  });
  await post(`/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: "tall_out",
    config: {},
    nodeStepId: filter.id,
  });
  return pipeline.id;
}

/** Overrides the last-run figures the pipeline page reads (a real 12M-row run is not seedable in an e2e). */
export async function stubLastRun(page: Page, rowCount: number) {
  await page.route(/\/api\/pipelines(\/[^/?]+)?(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const patch = (p: Record<string, unknown>) => ({
      ...p,
      lastRunStatus: "succeeded",
      lastRunAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      lastRunRowCount: rowCount,
    });
    await route.fulfill({
      response,
      json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>),
    });
  });
}

/** A tap as a real phone delivers it: the touch events, then the compatibility mouse move that leaves the element
 *  under the finger in `:hover` (which stays there until a touch lands elsewhere). Playwright's `tap()` alone sends
 *  only touch events, so it cannot reproduce a sticky hover. */
export async function realTap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("realTap: target has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.mouse.move(x - 2, y - 2);
  await page.mouse.move(x, y);
}
