import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import type { EchartsInstance, ReactFiber } from "./support/echartsFiber";
import { currentUserId, registerUser } from "./support/auth";
import { expectDeleted } from "./support/expectDeleted";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1615 -- saving the panel detail modal must not change an appearance field the user did not edit
// (stored `appearance.chart`, background, color, a non-whole-percent transparency), on the server AND in the
// client's Redux panel state / rendered chart type BEFORE the batch flush (then after it) -- standing constraint C1.
// The seeded panel stores chart.chartType "pie" (distinct from the bound Output's "bar" and from the "line"
// fallback) and transparency 0.555, so any loss is observable. The rendered type is read from the live ECharts
// option; Redux state is read through the react-redux Provider fiber. Ids are logged and deleted by exact id.

const CSRF = { "X-Helio-Requested-With": "1" };
const STORED_BG = "#112233";
const STORED_COLOR = "#aabbcc";
const STORED_TRANSPARENCY = 0.555;

interface ApiPanel {
  id: string;
  title: string;
  appearance: {
    background: string;
    color: string;
    transparency: number;
    chart?: { chartType?: string };
  };
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

async function serverPanel(
  request: APIRequestContext,
  dashboardId: string,
  panelId: string,
): Promise<ApiPanel> {
  const res = await request.get(`/api/dashboards/${dashboardId}/panels`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: ApiPanel[] } | ApiPanel[];
  const items = Array.isArray(body) ? body : (body.items ?? []);
  const found = items.find((p) => p.id === panelId);
  expect(found, `panel ${panelId} on the server`).toBeTruthy();
  return found!;
}

/** The rendered `series[].type` list of the first chart inside `card` (null until reachable). */
async function seriesTypes(card: Locator): Promise<string[] | null> {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas) => {
      let host: Element | null = canvas;
      type Comp = { getEchartsInstance(): EchartsInstance };
      let comp: Comp | null = null;
      while (host && !comp) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: ReactFiber | null | undefined = key
          ? (host as unknown as Record<string, ReactFiber>)[key]
          : null;
        while (f) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            comp = f.stateNode as Comp;
            break;
          }
          f = f.return;
        }
        host = host.parentElement;
      }
      if (!comp) return null;
      const o = comp.getEchartsInstance().getOption();
      return ((o.series ?? []) as { type?: string }[]).map((s) => s.type ?? "");
    })
    .catch(() => null);
}

async function renderedType(card: Locator): Promise<string> {
  await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  let seen: string[] | null = null;
  await expect
    .poll(
      async () => {
        seen = await seriesTypes(card);
        return seen !== null && seen.length > 0;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return Array.from(new Set(seen!)).join(",");
}

interface ClientState {
  appearance: ApiPanel["appearance"] | undefined;
  title: string | undefined;
  pending: unknown;
}

/** The panel's Redux state, read through the react-redux Provider's store (found by walking the fiber tree). */
async function clientState(page: Page, panelId: string): Promise<ClientState> {
  return page.evaluate((id) => {
    type Fiber = {
      child?: Fiber | null;
      sibling?: Fiber | null;
      memoizedProps?: { store?: { getState(): unknown } } | null;
    };
    const root = document.getElementById("root") as unknown as Record<string, Fiber> | null;
    const key = root ? Object.keys(root).find((k) => k.startsWith("__reactContainer$")) : undefined;
    let store: { getState(): unknown } | undefined;
    const stack: Fiber[] = key && root ? [root[key]] : [];
    while (stack.length && !store) {
      const f = stack.pop()!;
      if (f.memoizedProps && typeof f.memoizedProps.store?.getState === "function") {
        store = f.memoizedProps.store;
        break;
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    if (!store) throw new Error("redux store not found");
    const panels = (
      store.getState() as {
        panels: {
          items: { id: string; title: string; appearance: unknown }[];
          pendingPanelUpdates: Record<string, unknown>;
        };
      }
    ).panels;
    const p = panels.items.find((x) => x.id === id);
    return {
      appearance: JSON.parse(JSON.stringify(p?.appearance ?? null)) ?? undefined,
      title: p?.title,
      pending: JSON.parse(JSON.stringify(panels.pendingPanelUpdates[id] ?? null)),
    } as ClientState;
  }, panelId);
}

async function openEdit(page: Page, title: string): Promise<Locator> {
  const card = page.locator(".react-grid-item", { hasText: title });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: `${title} panel actions` }).click();
  await page.getByRole("menuitem", { name: "Customize" }).click();
  const sheet = page.getByRole("dialog", { name: /HEL-1615 .* settings$/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Panel title")).toBeVisible();
  return sheet;
}

test("modal save preserves unedited appearance (server and client, before and after the flush)", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const credentials = await registerUser(request, {
    prefix: "hel1615",
    displayName: "HEL-1615",
    logEmail: false,
  });
  const userId = await currentUserId(request);
  console.log(`[HEL-1615 e2e] created user ${userId}`);
  await loginThenIsolate(page, credentials);

  const batches: unknown[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/panels/updateBatch") && r.method() === "POST") {
      batches.push(r.postDataJSON());
    }
  });

  const created: { source?: string; pipeline?: string; dashboard?: string } = {};
  try {
    const source = await postJson<{ id: string }>(
      request,
      "/api/data-sources",
      {
        name: "HEL-1615 sales",
        type: "static",
        columns: [
          { name: "region", type: "string" },
          { name: "amount", type: "integer" },
        ],
        rows: [
          ["east", 8],
          ["west", 9],
          ["north", 4],
        ],
      },
      201,
    );
    created.source = source.id;
    const pipeline = await postJson<{ id: string }>(
      request,
      "/api/pipelines",
      { name: "HEL-1615 pipeline", roots: [{ sourceId: source.id }] },
      201,
    );
    created.pipeline = pipeline.id;
    const output = await postJson<{ id: string }>(
      request,
      `/api/pipelines/${pipeline.id}/outputs`,
      {
        kind: "chart",
        name: "HEL-1615 Output",
        config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "amount" } },
      },
      201,
    );
    const dashboard = await postJson<{ id: string }>(
      request,
      "/api/dashboards",
      { name: "HEL-1615 board" },
      201,
    );
    created.dashboard = dashboard.id;
    console.log(
      `[HEL-1615 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id} dashboard ${dashboard.id}`,
    );
    const run = await request.post(`/api/pipelines/${pipeline.id}/run`, {
      data: {},
      headers: CSRF,
    });
    expect(run.status(), await run.text()).toBe(200);

    const titles = ["HEL-1615 A api", "HEL-1615 B title", "HEL-1615 C bg", "HEL-1615 D two"];
    const batch = await postJson<{ panels: { id: string; title: string }[] }>(
      request,
      "/api/panels/batch",
      {
        dashboardId: dashboard.id,
        panels: titles.map((title) => ({
          title,
          type: "output",
          config: { outputId: output.id },
        })),
      },
      201,
    );
    const id = Object.fromEntries(batch.panels.map((p) => [p.title, p.id]));
    for (const t of titles) {
      const res = await request.patch(`/api/panels/${id[t]}`, {
        data: {
          appearance: {
            background: STORED_BG,
            color: STORED_COLOR,
            transparency: STORED_TRANSPARENCY,
            chart: { chartType: "pie" },
          },
        },
        headers: CSRF,
      });
      expect(res.status(), await res.text()).toBe(200);
    }
    await postJson(
      request,
      `/api/dashboards/${dashboard.id}/auto-layout`,
      { items: batch.panels.map((p) => ({ panelId: p.id, w: 6, h: 4 })) },
      200,
    );

    // ---- (a) API probe: the modal's exact batch body for a title-only save (rounded transparency) ----
    const aId = id["HEL-1615 A api"];
    const aBefore = await serverPanel(request, dashboard.id, aId);
    console.log(`[HEL-1615 probe] A before ${JSON.stringify(aBefore.appearance)}`);
    const aBody = {
      fields: ["title", "appearance"],
      panels: [
        {
          id: aId,
          title: "HEL-1615 A api renamed",
          appearance: { background: STORED_BG, color: STORED_COLOR, transparency: 0.56 },
        },
      ],
    };
    const aRes = await request.post("/api/panels/updateBatch", { data: aBody, headers: CSRF });
    expect(aRes.status(), await aRes.text()).toBe(200);
    const aAfter = await serverPanel(request, dashboard.id, aId);
    console.log(`[HEL-1615 probe] A body ${JSON.stringify(aBody)}`);
    console.log(
      `[HEL-1615 probe] A after ${JSON.stringify(aAfter.appearance)} title=${aAfter.title}`,
    );
    expect(aAfter.appearance.chart?.chartType, "A: server keeps chart").toBe("pie");
    expect(aAfter.appearance.background).toBe(STORED_BG);

    // ---- (b)(c)(d) real modal on the dev server ----
    await page.goto("/dashboards");
    await page.getByText("HEL-1615 board").first().click();
    for (const t of titles)
      await expect(page.locator(".react-grid-item", { hasText: t })).toBeVisible();

    const bId = id["HEL-1615 B title"];
    const cId = id["HEL-1615 C bg"];
    const dId = id["HEL-1615 D two"];
    const cardOf = (t: string) => page.locator(".react-grid-item", { hasText: t });

    // Baseline: the stored chart type renders as pie (not the Output's bar).
    expect(await renderedType(cardOf("HEL-1615 B title"))).toBe("pie");
    console.log(`[HEL-1615 probe] B client before ${JSON.stringify(await clientState(page, bId))}`);

    // B: title-only save.
    {
      const sheet = await openEdit(page, "HEL-1615 B title");
      await sheet.getByLabel("Panel title").fill("HEL-1615 B renamed");
      await sheet.getByRole("button", { name: "Save panel settings" }).click();
      await expect(sheet.getByRole("button", { name: "Edit panel" })).toBeVisible();
      const state = await clientState(page, bId);
      console.log(`[HEL-1615 probe] B client AFTER SAVE, BEFORE FLUSH ${JSON.stringify(state)}`);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      const type = await renderedType(cardOf("HEL-1615 B renamed"));
      console.log(`[HEL-1615 probe] B rendered chart type before flush: ${type}`);
      expect
        .soft(state.appearance?.chart?.chartType, "B client keeps chart before flush")
        .toBe("pie");
      expect.soft(state.appearance?.transparency, "B client keeps 0.555 before flush").toBe(0.555);
      expect.soft(type, "B rendered type before flush").toBe("pie");
    }
    // C: background-only save.
    {
      const sheet = await openEdit(page, "HEL-1615 C bg");
      await sheet.getByLabel("HEL-1615 C bg background color").fill("#445566");
      await sheet.getByRole("button", { name: "Save panel settings" }).click();
      await expect(sheet.getByRole("button", { name: "Edit panel" })).toBeVisible();
      const state = await clientState(page, cId);
      console.log(`[HEL-1615 probe] C client AFTER SAVE, BEFORE FLUSH ${JSON.stringify(state)}`);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      const type = await renderedType(cardOf("HEL-1615 C bg"));
      console.log(`[HEL-1615 probe] C rendered chart type before flush: ${type}`);
      expect
        .soft(state.appearance?.chart?.chartType, "C client keeps chart before flush")
        .toBe("pie");
      expect.soft(state.appearance?.transparency, "C client keeps 0.555 before flush").toBe(0.555);
      expect.soft(state.appearance?.background, "C client new background").toBe("#445566");
      expect.soft(type, "C rendered type before flush").toBe("pie");
    }
    // D: two partial saves (background, then color) before a flush.
    {
      let sheet = await openEdit(page, "HEL-1615 D two");
      await sheet.getByLabel("HEL-1615 D two background color").fill("#778899");
      await sheet.getByRole("button", { name: "Save panel settings" }).click();
      await expect(sheet.getByRole("button", { name: "Edit panel" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      sheet = await openEdit(page, "HEL-1615 D two");
      await sheet.getByLabel("HEL-1615 D two text color").fill("#ddeeff");
      await sheet.getByRole("button", { name: "Save panel settings" }).click();
      await expect(sheet.getByRole("button", { name: "Edit panel" })).toBeVisible();
      const state = await clientState(page, dId);
      console.log(`[HEL-1615 probe] D client AFTER 2 SAVES, BEFORE FLUSH ${JSON.stringify(state)}`);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }

    // Flush: Save now, wait for the batch round trip.
    expect(batches.length, "no batch sent before the explicit flush").toBe(0);
    const flushed = page.waitForResponse(
      (r) => r.url().endsWith("/api/panels/updateBatch") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save now" }).click({ force: true });
    expect((await flushed).status()).toBe(200);
    await page.waitForTimeout(500);
    console.log(`[HEL-1615 probe] flushed batch body ${JSON.stringify(batches)}`);

    for (const [label, pid, title] of [
      ["B", bId, "HEL-1615 B renamed"],
      ["C", cId, "HEL-1615 C bg"],
      ["D", dId, "HEL-1615 D two"],
    ] as const) {
      const server = await serverPanel(request, dashboard.id, pid);
      const client = await clientState(page, pid);
      const type = await renderedType(cardOf(title));
      console.log(
        `[HEL-1615 probe] ${label} AFTER FLUSH server ${JSON.stringify(server.appearance)} title=${server.title}`,
      );
      console.log(
        `[HEL-1615 probe] ${label} AFTER FLUSH client ${JSON.stringify(client.appearance)} rendered=${type}`,
      );
      expect.soft(server.appearance.chart?.chartType, `${label} server chart`).toBe("pie");
      expect.soft(server.appearance.transparency, `${label} server transparency`).toBe(0.555);
      expect
        .soft(client.appearance?.chart?.chartType, `${label} client chart after flush`)
        .toBe("pie");
      expect.soft(type, `${label} rendered type after flush`).toBe("pie");
      if (label === "B") {
        expect.soft(server.appearance.background, "B server background").toBe(STORED_BG);
        expect.soft(server.appearance.color, "B server color").toBe(STORED_COLOR);
      }
      if (label === "C") {
        expect.soft(server.appearance.background, "C server background").toBe("#445566");
        expect.soft(server.appearance.color, "C server color").toBe(STORED_COLOR);
      }
      if (label === "D") {
        expect.soft(server.appearance.background, "D server background").toBe("#778899");
        expect.soft(server.appearance.color, "D server color").toBe("#ddeeff");
      }
    }
  } finally {
    console.log(
      `[HEL-1615 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} source ${created.source}`,
    );
    if (created.dashboard)
      await expectDeleted(request, `/api/dashboards/${created.dashboard}`, CSRF);
    if (created.pipeline) await expectDeleted(request, `/api/pipelines/${created.pipeline}`, CSRF);
    if (created.source) await expectDeleted(request, `/api/data-sources/${created.source}`, CSRF);
  }
});
