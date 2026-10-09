import { expect, test, type APIRequestContext } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1390 — the seam probe for "Add as tail with aggregate" on a CHART Output. Client and server
// each passed their own tests while disagreeing on the wire: the builder wrote fieldMapping
// { category, value } and the server 400s any key that is not a chart slot (xAxis/yAxis/series/
// annotation). This drives the real sheet and asserts the create is 2xx, the aggregate step
// persisted, and the stored Output config carries { xAxis, yAxis }. Every created id is logged and
// deleted by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };

test("chart Output 'Add as tail with aggregate' stores xAxis/yAxis slots", async ({
  page,
  request,
}: {
  page: import("@playwright/test").Page;
  request: APIRequestContext;
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const credentials = await registerUser(request, {
    prefix: "hel1390",
    displayName: "HEL-1390",
    logEmail: false,
  });
  const userId = await currentUserId(request);
  console.log(`[HEL-1390 e2e] created user ${userId}`);
  await loginThenIsolate(page, credentials);

  const created: { source?: string; pipeline?: string } = {};
  try {
    const sourceRes = await request.post("/api/data-sources", {
      headers: CSRF,
      data: {
        name: "HEL-1390 sales",
        type: "static",
        columns: [
          { name: "region", type: "string" },
          { name: "amount", type: "integer" },
        ],
        rows: [
          ["east", 8],
          ["east", 2],
          ["west", 9],
          ["north", 4],
        ],
      },
    });
    expect(sourceRes.status(), await sourceRes.text()).toBe(201);
    created.source = ((await sourceRes.json()) as { id: string }).id;
    const pipelineRes = await request.post("/api/pipelines", {
      headers: CSRF,
      data: { name: "HEL-1390 pipeline", roots: [{ sourceId: created.source }] },
    });
    expect(pipelineRes.status(), await pipelineRes.text()).toBe(201);
    created.pipeline = ((await pipelineRes.json()) as { id: string }).id;
    const limitRes = await request.post(`/api/pipelines/${created.pipeline}/steps`, {
      headers: CSRF,
      data: { type: "limit", config: { count: 10 } },
    });
    expect(limitRes.status(), await limitRes.text()).toBe(201);
    console.log(`[HEL-1390 e2e] created source ${created.source} pipeline ${created.pipeline}`);

    await page.goto(`/pipelines/${created.pipeline}`);
    await page.getByRole("button", { name: "Add output" }).first().click();
    const sheet = page.getByRole("dialog").last();
    await sheet.getByLabel("Name").fill("HEL-1390 by region");

    const pick = async (ariaLabel: string, option: string | RegExp) => {
      await sheet.getByRole("combobox", { name: ariaLabel }).click();
      await page.getByRole("option", { name: option }).first().click();
    };
    await pick("Group by field", "region");
    await pick("Aggregation value field", "amount");
    await pick("Aggregation function", /sum/i);

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/pipelines/${created.pipeline}/outputs`) &&
        r.request().method() === "POST",
    );
    await page.screenshot({ path: evidencePath("HEL-1390", "sheet-before-tail.png") });
    await sheet.getByRole("button", { name: "Add as tail with aggregate" }).click();
    const res = await createResponse;
    console.log(`[HEL-1390 e2e] POST outputs -> ${res.status()} ${await res.text()}`);
    expect(res.status()).toBe(201);

    const list = await request.get(`/api/pipelines/${created.pipeline}/outputs`);
    const outputs = (await list.json()) as
      | {
          items?: { kind: string; config: { fieldMapping?: Record<string, string> } }[];
        }
      | { kind: string; config: { fieldMapping?: Record<string, string> } }[];
    const arr = Array.isArray(outputs) ? outputs : (outputs.items ?? []);
    console.log(`[HEL-1390 e2e] stored outputs: ${JSON.stringify(arr)}`);
    expect(arr).toHaveLength(1);
    expect(arr[0].kind).toBe("chart");
    expect(arr[0].config.fieldMapping).toEqual({ xAxis: "region", yAxis: "sum_amount" });

    const steps = await request.get(`/api/pipelines/${created.pipeline}/steps`);
    console.log(`[HEL-1390 e2e] steps: ${await steps.text()}`);
    expect(await steps.text()).toContain("aggregate");

    await page.reload();
    await expect(
      page.locator(".outputs-rail__name", { hasText: "HEL-1390 by region" }).first(),
    ).toBeVisible();
    await page.screenshot({ path: evidencePath("HEL-1390", "after-tail.png") });
  } finally {
    console.log(`[HEL-1390 e2e] deleting pipeline ${created.pipeline} source ${created.source}`);
    if (created.pipeline)
      await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
    if (created.source)
      await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
  }
});
