import { expect, test } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";

// HEL-1521 — the rejoin picker disables every lane choice the server rejects for a cycle: a step's
// parent-chain descendants and the steps that depend on it through lane links, not just its ancestors.
// The pipeline is built through the API: head (Limit rows) -> u (Union, the configuring step) -> kid
// (Sort rows), plus two tails of head: `linked` (Join tables, lanes to kid, so it depends on u) and
// `free` (Select fields, unrelated). Opening u's picker must show kid and linked disabled with the
// cycle reason and free enabled. The throwaway @example.test user is recorded by registerUser and
// deleted by exact id in the run's global teardown (userCleanupCore buildUserDeleteSql).
test.describe("HEL-1521 — lane picker disables descendants and lane-linked dependents", () => {
  test("a descendant and a lane-linked dependent are disabled; an unrelated node is selectable", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await registerAndLogin(page, request, {
      prefix: "hel1521",
      label: "picker",
      displayName: "HEL-1521 E2E",
    });
    const headers = { [CSRF_HEADER]: "1" };

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-1521 source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers,
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: { name: "HEL-1521 pipeline", roots: [{ sourceId: source.id }] },
      headers,
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    async function addStep(data: Record<string, unknown>): Promise<string> {
      const res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
        data,
        headers,
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).id as string;
    }

    const head = await addStep({ type: "limit", config: { count: 2 } });
    await addStep({
      type: "union",
      config: { secondaryInput: { kind: "source", dataSourceId: source.id }, mode: "byPosition" },
      parentStepId: head,
    });
    const steps = await (await page.request.get(`/api/pipelines/${pipeline.id}/steps`)).json();
    const unionId = steps.find((s: { type: string }) => s.type === "union").id as string;
    const kid = await addStep({
      type: "sort",
      config: { sortBy: [{ field: "amount", direction: "asc" }] },
      parentStepId: unionId,
    });
    await addStep({
      type: "join",
      config: {
        secondaryInput: { kind: "lane", stepId: kid },
        joinKey: "amount",
        joinType: "inner",
      },
      parentStepId: head,
      attachAsTail: true,
    });
    await addStep({
      type: "select",
      config: { fields: ["amount"] },
      parentStepId: head,
      attachAsTail: true,
    });

    await page.goto(`/pipelines/${pipeline.id}`);
    await page.getByRole("button", { name: "Union / append rows", exact: false }).click();
    await page.getByRole("combobox", { name: "Other source" }).click();

    for (const label of ["Sort rows", "Join tables"]) {
      const option = page.getByRole("option", { name: new RegExp(`Lane node: ${label}`) });
      await expect(option).toHaveText(`Lane node: ${label} (would create a cycle)`);
      await expect(option).toHaveAttribute("aria-disabled", "true");
    }
    const free = page.getByRole("option", { name: "Lane node: Select fields" });
    await expect(free).toBeVisible();
    await expect(free).not.toHaveAttribute("aria-disabled", "true");
  });
});
