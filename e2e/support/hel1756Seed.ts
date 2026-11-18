import { expect, type Page } from "@playwright/test";

const CSRF = { "X-Helio-Requested-With": "1" };

async function post<T>(page: Page, url: string, data: unknown, status = 201): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** HEL-1756 -- seeds a dashboard of `panelCount` table-Output panels backed by one run pipeline (filter, sort, assert
 *  steps, so the provenance popover has a full chain and a Checks section) and returns its id. The throwaway user is
 *  recorded by registerUser and deleted by exact id in the run's global teardown. */
export async function seedProvenanceDashboard(
  page: Page,
  name: string,
  panelCount: number,
): Promise<{ dashboardId: string; outputId: string }> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: `${name} source`,
    type: "static",
    columns: [
      { name: "region", type: "string" },
      { name: "amount", type: "integer" },
    ],
    rows: [
      ["east", 500],
      ["west", 575],
      ["north", 640],
    ],
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: `${name} pipeline`,
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, { type, config });
  await step("filter", {
    combinator: "and",
    conditions: [{ field: "amount", operator: ">=", value: "100" }],
  });
  const sort = await step("sort", { sortBy: [{ field: "amount", direction: "asc" }] });
  await step("assert", {
    rules: [{ kind: "notNull", field: "region", params: {}, severity: "warn" }],
  });
  const output = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: `${name} output`,
    config: {},
    nodeStepId: sort.id,
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {}, 200);
  const dashboard = await post<{ id: string }>(page, "/api/dashboards", { name });
  for (let i = 1; i <= panelCount; i += 1) {
    await post(page, "/api/panels", {
      dashboardId: dashboard.id,
      title: `${name} panel ${i}`,
      type: "output",
      config: { outputId: output.id },
    });
  }
  return { dashboardId: dashboard.id, outputId: output.id };
}
