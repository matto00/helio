import { expect, test } from "@playwright/test";

// HEL-958 — build a join through the pipeline UI (palette -> "Join tables" -> right source, key,
// type), run the pipeline, and assert the REAL output rows, including HEL-1236's `right_<name>`
// prefix for the column both sources carry. Asserts the values produced, not just that each
// interaction succeeded.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(): string {
  return `hel958-join-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-958 join step editor", () => {
  test("a join built in the UI runs and yields joined rows with a right_<name> collision column", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const headers = { [CSRF_HEADER]: "1" };
    const registerRes = await page.request.post("/api/auth/register", {
      data: { email: uniqueEmail(), password: "correcthorsebattery1", displayName: "HEL-958 Join" },
      headers,
    });
    expect(registerRes.status()).toBe(201);

    // Left: id, name, score. Right: id, name (collides), city. ids 1,2 match; 3 / 4 do not.
    const left = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-958 Left",
        type: "static",
        columns: [
          { name: "id", type: "integer" },
          { name: "name", type: "string" },
          { name: "score", type: "integer" },
        ],
        rows: [
          [1, "ann", 10],
          [2, "bob", 20],
          [3, "cy", 30],
        ],
      },
      headers,
    });
    expect(left.status()).toBe(201);
    const right = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-958 Right",
        type: "static",
        columns: [
          { name: "id", type: "integer" },
          { name: "name", type: "string" },
          { name: "city", type: "string" },
        ],
        rows: [
          [1, "ANN", "Oslo"],
          [2, "BOB", "Rome"],
          [4, "DEE", "Kyiv"],
        ],
      },
      headers,
    });
    expect(right.status()).toBe(201);
    const leftSource = (await left.json()) as { id: string };

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: { name: "HEL-958 Join Pipeline", roots: [{ sourceId: leftSource.id }] },
      headers,
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as { id: string };

    // The register call set the session cookie on this context; load the app as that user.
    await page.goto(`/pipelines/${pipeline.id}`);

    // ── Add "Join tables" from the palette; it must be offered (catalog says authorable). ──
    const created = page.waitForResponse(
      (res) =>
        res.url().includes(`/pipelines/${pipeline.id}/steps`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByRole("option", { name: /^Join tables/ }).click();
    expect((await created).status()).toBe(201);

    // ── Configure: right source, key, type. ──
    await page.getByRole("button", { name: "Join tables", exact: false }).first().click();
    const patched = (n: number) =>
      page.waitForResponse(
        (res) => res.url().includes("/pipeline-steps/") && res.request().method() === "PATCH",
        { timeout: 5000 + n },
      );
    let pending = patched(0);
    await page.getByRole("combobox", { name: "Right source" }).click();
    await page.getByRole("option", { name: "Data source: HEL-958 Right" }).click();
    await pending;
    pending = patched(1);
    await page.getByRole("combobox", { name: "Join key" }).click();
    await page.getByRole("option", { name: "id", exact: true }).click();
    await pending;
    pending = patched(2);
    await page.getByRole("button", { name: "INNER" }).click();
    await pending;

    // ── An Output on the join step itself (the UI-built step, found by type), then run. ──
    const stepsRes = await page.request.get(`/api/pipelines/${pipeline.id}/steps`);
    const joinStep = ((await stepsRes.json()) as { id: string; type: string }[]).find(
      (st) => st.type === "join",
    );
    expect(joinStep).toBeDefined();
    const outputRes = await page.request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: { kind: "table", name: "HEL-958 Joined", nodeStepId: joinStep!.id },
      headers,
    });
    expect(outputRes.status()).toBe(201);
    const output = (await outputRes.json()) as { id: string };
    const runRes = await page.request.post(`/api/pipelines/${pipeline.id}/run`, {
      data: {},
      headers,
    });
    expect(runRes.status()).toBe(200);

    let items: Record<string, unknown>[] = [];
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/outputs/${output.id}/rows`);
          if (res.status() !== 200) return 0;
          items = ((await res.json()) as { items: Record<string, unknown>[] }).items;
          return items.length;
        },
        { timeout: 20_000 },
      )
      .toBe(2);

    const byId = new Map(items.map((r) => [Number(r.id), r]));
    expect([...byId.keys()].sort()).toEqual([1, 2]); // 3 (left only) and 4 (right only) dropped
    expect(byId.get(1)).toMatchObject({ name: "ann", score: 10, right_name: "ANN", city: "Oslo" });
    expect(byId.get(2)).toMatchObject({ name: "bob", score: 20, right_name: "BOB", city: "Rome" });
  });
});
