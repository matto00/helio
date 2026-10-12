import { expect, test } from "@playwright/test";
import { CSRF_HEADER, currentUserId, registerUser } from "./support/auth";

// HEL-1515 -- the backend rejects a lane reference to a step that depends on the configuring step (400).
// The picker must therefore not offer one as a live option, and a rejected save must show the backend's
// message instead of silently losing the edit. Trunk: Limit A -> Union U -> Limit C (C depends on U).
test.describe("HEL-1515 lane picker: dependents", () => {
  test("a dependent is disabled with a cycle reason, and a rejected save shows the backend message", async ({
    page,
  }) => {
    await registerUser(page.request, {
      prefix: "hel1515",
      label: "picker",
      displayName: "HEL-1515 Picker E2E",
    });
    await currentUserId(page.request);
    const headers = { [CSRF_HEADER]: "1" };

    const source = await (
      await page.request.post("/api/data-sources", {
        data: {
          name: "HEL-1515 Source",
          type: "static",
          columns: [{ name: "amount", type: "integer" }],
          rows: [[10], [20], [30]],
        },
        headers,
      })
    ).json();
    const pipelineRes = await page.request.post("/api/pipelines", {
      data: { name: "HEL-1515 Picker", roots: [{ sourceId: source.id }] },
      headers,
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();
    const add = async (data: unknown) => {
      const res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, { data, headers });
      expect(res.status()).toBe(201);
      return res.json();
    };
    await add({ type: "limit", config: { count: 5 } });
    await add({
      type: "union",
      config: { secondaryInput: { kind: "source", dataSourceId: "" }, mode: "byPosition" },
    });
    await add({ type: "limit", config: { count: 2 } });

    await page.goto(`/pipelines/${pipeline.id}`);

    await page.getByRole("button", { name: "Union / append rows", exact: false }).click();
    await page.getByRole("combobox", { name: "Other source" }).click();
    const options = page.getByRole("option", { name: /Lane node: Limit rows/ });
    // A (ancestor) and C (dependent) are both listed, both disabled, both with visible cycle text.
    await expect(options).toHaveCount(2);
    for (const option of await options.all()) {
      await expect(option).toHaveAttribute("aria-disabled", "true");
      await expect(option).toContainText("would create a cycle");
    }
    await page.keyboard.press("Escape");

    // A forced 400 (as a racing edit would produce) shows its message on the card.
    await page.route("**/api/pipeline-steps/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Lane reference 'x' would create a cycle (it depends on this step).",
        }),
      });
    });
    await page.getByRole("combobox", { name: "Other source" }).click();
    await page.getByRole("option", { name: /Data source: HEL-1515 Source/ }).click();
    await expect(page.getByText("it depends on this step")).toBeVisible();
  });
});
