import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { isolateLivePage } from "./support/isolateLivePage";

// HEL-1345 — a UI step append and a UI gap insert must PERSIST where the editor shows them.
// Before the fix the backend head-spliced every `rootId` create (the bottom-row append sends
// `rootId` with no `position`), so the editor looked right until a reload put the appended step
// first. This spec appends through the bottom add row, inserts between the first two steps through
// the gap affordance, reloads, and asserts the order through BOTH the rendered lane and the steps
// API. It records every id it creates (HEL1345_IDS_FILE, when set) and deletes the pipeline and the
// source by id in `afterAll`; the throwaway user has no delete route, so its id is recorded for
// exact-id cleanup by the operator.
const CSRF = { "X-Helio-Requested-With": "1" };
const password = "correcthorsebattery1";

type Created = { userEmail: string; userId?: string; sourceId?: string; pipelineId?: string };

test.describe("HEL-1345 — rootId step create placement persists", () => {
  const created: Created = {
    userEmail: `hel1345-e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`,
  };

  function record(): void {
    console.log(`HEL1345-IDS ${JSON.stringify(created)}`);
    if (process.env.HEL1345_IDS_FILE) {
      appendFileSync(process.env.HEL1345_IDS_FILE, `${JSON.stringify(created)}\n`);
    }
  }

  test.afterAll(async ({ request }) => {
    // Session cookie is per test context; log in again to delete by exact id.
    const login = await request.post("/api/auth/login", {
      data: { email: created.userEmail, password },
      headers: CSRF,
    });
    if (login.ok()) {
      if (created.pipelineId)
        await request.delete(`/api/pipelines/${created.pipelineId}`, { headers: CSRF });
      if (created.sourceId)
        await request.delete(`/api/data-sources/${created.sourceId}`, { headers: CSRF });
    }
  });

  test("append then insert, reload: persisted order equals the displayed order", async ({
    page,
  }) => {
    const reg = await page.request.post("/api/auth/register", {
      data: { email: created.userEmail, password, displayName: "HEL-1345 E2E" },
      headers: CSRF,
    });
    expect(reg.status()).toBe(201);
    created.userId = (await reg.json()).id ?? (await reg.json()).user?.id;
    record();
    await isolateLivePage(page);

    const src = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-1345 e2e source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers: CSRF,
    });
    expect(src.status()).toBe(201);
    created.sourceId = (await src.json()).id;
    record();

    const pl = await page.request.post("/api/pipelines", {
      data: {
        name: "HEL-1345 e2e pipeline",
        roots: [{ sourceId: created.sourceId }],
        outputDataTypeName: "HEL-1345 out",
      },
      headers: CSRF,
    });
    expect(pl.status()).toBe(201);
    created.pipelineId = (await pl.json()).id;
    record();
    const pid = created.pipelineId!;

    for (const body of [
      { type: "limit", config: { count: 2 } },
      { type: "sort", config: { sortBy: [{ field: "amount", direction: "asc" }] } },
    ]) {
      const r = await page.request.post(`/api/pipelines/${pid}/steps`, {
        data: body,
        headers: CSRF,
      });
      expect(r.status()).toBe(201);
    }

    await page.goto(`/pipelines/${pid}`);
    const labels = page.locator(".pipeline-detail-page__step-card-label");
    await expect(labels).toHaveCount(2);
    await expect(labels.nth(0)).toHaveText("Limit rows");
    await expect(labels.nth(1)).toHaveText("Sort rows");

    // Append through the bottom add row.
    await page.getByRole("button", { name: "+ Add transformation step" }).click();
    await page.getByRole("option", { name: /Select fields/ }).click();
    await expect(labels).toHaveCount(3);
    await expect(labels.nth(2)).toHaveText("Select fields");
    // The toggle is disabled while the create is in flight; wait for it to settle.
    await expect(page.getByRole("button", { name: /Select fields/ })).toBeEnabled();

    // Insert between Limit and Sort through the gap affordance.
    await page.getByRole("button", { name: "Insert step here" }).nth(1).click();
    await page.getByRole("option", { name: /Cast type/ }).click();
    await expect(labels).toHaveCount(4);
    await expect(page.getByRole("button", { name: /Cast type/ })).toBeEnabled();
    const expected = ["Limit rows", "Cast type", "Sort rows", "Select fields"];
    await expect(labels).toHaveText(expected);

    // Reload: the persisted tree must show the same order.
    await page.goto(`/pipelines/${pid}`);
    await expect(labels).toHaveCount(4);
    await expect(labels).toHaveText(expected);

    // And the steps API: walk the parent chain from the root-level step.
    const res = await page.request.get(`/api/pipelines/${pid}/steps`);
    expect(res.status()).toBe(200);
    const steps: Array<{ id: string; type: string; parentStepId?: string | null }> =
      await res.json();
    const head = steps.find((s) => !s.parentStepId);
    expect(head).toBeDefined();
    const chain: string[] = [];
    let cur = head;
    while (cur) {
      chain.push(cur.type);
      cur = steps.find((s) => s.parentStepId === cur!.id);
    }
    expect(chain).toEqual(["limit", "cast", "sort", "select"]);
  });
});
