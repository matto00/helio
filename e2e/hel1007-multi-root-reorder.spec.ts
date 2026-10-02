import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

// HEL-1007 — the editor wired Move up/down + drag-reorder for root 0 only; every other root's lane
// rendered permanently-disabled Move buttons. Driven through the real running UI against the live
// backend: reorder in root 1's lane by KEYBOARD, reload, assert the order persisted, the other root is
// untouched, the Move controls name their lane, and focus follows the moved step.

const CSRF = { "X-Helio-Requested-With": "1" };
const PASSWORD = "correcthorsebattery1";

interface StepRow {
  id: string;
  type: string;
  rootId?: string;
  parentStepId?: string;
}

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} -> ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

async function createSource(request: APIRequestContext, name: string) {
  return post<{ id: string }>(request, "/api/data-sources", {
    name,
    type: "static",
    columns: [{ name: "amount", type: "integer" }],
    rows: [[10], [20], [30]],
  });
}

function stepCard(lane: Locator, label: string): Locator {
  return lane.locator(".pipeline-detail-page__step-card", {
    has: lane.page().locator(".pipeline-detail-page__step-card-label", { hasText: label }),
  });
}

async function labelsIn(lane: Locator): Promise<string[]> {
  return lane.locator(".pipeline-detail-page__step-card-label").allTextContents();
}

test.describe("HEL-1007 reorder every root's lane", () => {
  test("keyboard reorder in root 1's lane persists across reload; root 0 untouched; names and focus", async ({
    page,
  }) => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const email = `hel1007-${stamp}@example.com`;
    const nameA = `HEL-1007 Alpha ${stamp}`;
    const nameB = `HEL-1007 Beta ${stamp}`;
    const request = page.request;
    const created: { pipelineId?: string; sourceIds: string[] } = { sourceIds: [] };

    const reg = await request.post("/api/auth/register", {
      data: { email, password: PASSWORD, displayName: "HEL-1007" },
      headers: CSRF,
    });
    expect(reg.status()).toBe(201);

    try {
      const srcA = await createSource(request, nameA);
      const srcB = await createSource(request, nameB);
      created.sourceIds.push(srcA.id, srcB.id);
      const pipeline = await post<{ id: string; roots: { id: string }[] }>(
        request,
        "/api/pipelines",
        { name: `HEL-1007 Pipeline ${stamp}`, roots: [{ sourceId: srcA.id }] },
      );
      created.pipelineId = pipeline.id;
      const rootB = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/roots`, {
        sourceId: srcB.id,
      });
      const rootA = pipeline.roots[0];
      console.log(
        `HEL1007-IDS ${JSON.stringify({ email, pipeline: pipeline.id, sources: created.sourceIds, rootA: rootA?.id, rootB: rootB.id })}`,
      );

      // Root 0 trunk: Limit, Sort, Select. Root 1 trunk: Select, Limit, Sort (distinct orders).
      const sortCfg = { sortBy: [{ field: "amount", direction: "asc" }] };
      // A root-level create (`rootId`, no parent) on a root that already has steps inserts at the
      // HEAD of that root (probed: three creates landed in reverse order). To build each trunk in
      // creation order, anchor every step after the first on its predecessor (`parentStepId`).
      const mk = (
        type: string,
        config: unknown,
        anchor: { rootId: string } | { parentStepId: string },
      ) =>
        post<StepRow>(request, `/api/pipelines/${pipeline.id}/steps`, { type, config, ...anchor });
      const a0 = await mk("limit", { count: 2 }, { rootId: rootA!.id });
      const a1 = await mk("sort", sortCfg, { parentStepId: a0.id });
      const a2 = await mk("select", { columns: ["amount"] }, { parentStepId: a1.id });
      const b0 = await mk("select", { columns: ["amount"] }, { rootId: rootB.id });
      const b1 = await mk("limit", { count: 2 }, { parentStepId: b0.id });
      const b2 = await mk("sort", sortCfg, { parentStepId: b1.id });
      console.log(`HEL1007-STEPS ${JSON.stringify([a0, a1, a2, b0, b1, b2].map((s) => s.id))}`);

      // `page.request.post(register)` already set the session cookie on the page's context.
      await page.goto(`/pipelines/${pipeline.id}`);
      const laneA = page.locator(".pipeline-detail-page__river-inner");
      const laneB = page.locator(
        `.pipeline-detail-page__root-column[aria-label="Source: ${nameB}"]`,
      );
      await expect(laneB).toBeVisible();
      expect(await labelsIn(laneA)).toEqual(["Limit rows", "Sort rows", "Select fields"]);
      expect(await labelsIn(laneB)).toEqual(["Select fields", "Limit rows", "Sort rows"]);

      // Move controls name their lane (the root's source name).
      // Soft, so the behavioural assertions below still run (and fail) independently of naming.
      await expect
        .soft(laneB.getByRole("button", { name: `Move step up in ${nameB}` }))
        .toHaveCount(3);
      await expect
        .soft(laneA.getByRole("button", { name: `Move step up in ${nameA}` }))
        .toHaveCount(3);

      // Keyboard: focus root 1's last card's Move up, activate with Enter.
      const sortUp = stepCard(laneB, "Sort rows").getByRole("button", { name: /^Move step up/ });
      await expect(sortUp).toBeEnabled();
      const put = page.waitForRequest(
        (r) => r.url().includes("/steps/order") && r.method() === "PUT",
      );
      await sortUp.focus();
      await page.keyboard.press("Enter");
      const body = (await put).postDataJSON() as { stepIds: string[] };
      // Whole-pipeline payload: root 0's trunk unchanged, root 1's trunk with Sort moved above Limit.
      expect(body.stepIds).toEqual([a0.id, a1.id, a2.id, b0.id, b2.id, b1.id]);

      await expect
        .poll(() => labelsIn(laneB))
        .toEqual(["Select fields", "Sort rows", "Limit rows"]);
      expect(await labelsIn(laneA)).toEqual(["Limit rows", "Sort rows", "Select fields"]);
      // Focus follows the moved step: its own Move up button (still enabled at index 1).
      await expect(
        stepCard(laneB, "Sort rows").getByRole("button", { name: /^Move step up/ }),
      ).toBeFocused();

      // Persists across reload; ownership unchanged.
      await page.reload();
      await expect(laneB).toBeVisible();
      await expect
        .poll(() => labelsIn(laneB))
        .toEqual(["Select fields", "Sort rows", "Limit rows"]);
      expect(await labelsIn(laneA)).toEqual(["Limit rows", "Sort rows", "Select fields"]);

      const listed = await request.get(`/api/pipelines/${pipeline.id}/steps`);
      expect(listed.status()).toBe(200);
      const steps = (await listed.json()) as StepRow[];
      const step = (id: string) => steps.find((s) => s.id === id);
      // Ownership is carried by the root's head step (`rootId`, no parent); the rest of a root's
      // trunk hangs off it by `parentStepId`. Root 0 untouched; root 1: Select -> Sort -> Limit.
      expect(step(a0.id)?.rootId).toBe(rootA!.id);
      expect(step(a1.id)?.parentStepId).toBe(a0.id);
      expect(step(a2.id)?.parentStepId).toBe(a1.id);
      expect(step(b0.id)?.rootId).toBe(rootB.id);
      expect(step(b2.id)?.parentStepId).toBe(b0.id);
      expect(step(b1.id)?.parentStepId).toBe(b2.id);
      expect(
        steps
          .filter((s) => s.rootId)
          .map((s) => s.id)
          .sort(),
      ).toEqual([a0.id, b0.id].sort());
    } finally {
      if (created.pipelineId) {
        await request.delete(`/api/pipelines/${created.pipelineId}`, { headers: CSRF });
      }
      for (const id of created.sourceIds) {
        await request.delete(`/api/data-sources/${id}`, { headers: CSRF });
      }
    }
  });
});
