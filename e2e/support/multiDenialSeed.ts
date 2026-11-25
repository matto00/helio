import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { CSRF_HEADER } from "./auth";

// HEL-1172 / HEL-1840 -- the shared seed for the multi-denial toast specs: ONE form panel whose dataset write denies
// every seeded pipeline. Denial mechanism is hel1096's: 21 enabled no-op `assert` steps per pipeline
// (`steps-above-bound`) -- deliberately not an AI step, so a real manual run never needs a model.

/** A request that waits out the general `/api` rate limit (120 requests per 60 s): a six-pipeline seed makes ~150 calls,
 *  so EVERY seed call goes through here and the caller's status assertion sees the post-retry response. */
async function send(
  request: APIRequestContext,
  method: "post" | "patch",
  url: string,
  data: unknown,
  headers: Record<string, string>,
) {
  for (let attempt = 0; ; attempt++) {
    const res = await request[method](url, { data, headers });
    if (res.status() !== 429 || attempt >= 6) return res;
    const retryAfter = Number(res.headers()["retry-after"]);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter > 0 ? retryAfter : 5) * 1000));
  }
}

export interface SeededPipeline {
  id: string;
  name: string;
}

interface Created {
  id: string;
}

/**
 * Seeds the source, one pipeline per name, a dashboard and the form panel. `names` is the desired NAME order.
 * Server ids are random UUIDs, so which name sorts first by id varies per run; a spec that must tell name order
 * from id order cannot rely on that. With `idsOppositeToNames` the names are assigned AFTER creation, from the ids'
 * order, so the id order is exactly the reverse of the name order in every run (a revert to id order is then always
 * observable). Returns the pipelines in `names` order.
 */
export async function seedMultiDenial(
  request: APIRequestContext,
  names: string[],
  options: { idsOppositeToNames?: boolean } = {},
): Promise<SeededPipeline[]> {
  const headers = { [CSRF_HEADER]: "1" };
  const sourceRes = await send(
    request,
    "post",
    "/api/data-sources",
    {
      name: "HEL-1172 e2e Source",
      type: "static",
      columns: [{ name: "note", type: "string", required: true }],
      rows: [["seed"]],
    },
    headers,
  );
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as Created;

  const created: SeededPipeline[] = [];
  for (const name of names) {
    // One transactional call per pipeline: the root, 21 enabled no-op `assert` steps (parentless ones extend the
    // trunk, in order) and the root-bound table Output. A failure rolls the whole call back.
    const pipelineRes = await send(
      request,
      "post",
      "/api/pipelines",
      {
        name,
        roots: [{ sourceId: source.id }],
        steps: Array.from({ length: 21 }, (_, i) => ({
          clientId: `assert-${i}`,
          type: "assert",
          config: { rules: [] },
        })),
        outputs: [{ kind: "table", name: `${name} Table`, config: {} }],
      },
      headers,
    );
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as Created;
    created.push({ id: pipeline.id, name });
  }

  if (options.idsOppositeToNames === true) {
    const byIdAsc = [...created].sort((a, b) => a.id.localeCompare(b.id));
    for (const [rank, pipeline] of byIdAsc.entries()) {
      const name = names[names.length - 1 - rank];
      const res = await send(request, "patch", `/api/pipelines/${pipeline.id}`, { name }, headers);
      expect(res.status()).toBe(200);
      pipeline.name = name;
    }
  }

  const dashRes = await send(
    request,
    "post",
    "/api/dashboards",
    { name: "HEL-1172 e2e Dashboard" },
    headers,
  );
  expect(dashRes.status()).toBe(201);
  const dashboard = (await dashRes.json()) as Created;
  const panelRes = await send(
    request,
    "post",
    "/api/panels",
    {
      dashboardId: dashboard.id,
      title: "HEL-1172 e2e Form",
      type: "form",
      config: {
        dataSourceId: source.id,
        fields: [{ sourceField: "note", control: "text", label: "Note", required: true }],
        submit: { writeMode: "append" },
      },
    },
    headers,
  );
  expect(panelRes.status()).toBe(201);

  // The returned order is the `names` order (renamed pipelines carry their new name).
  return names.map((name) => created.find((p) => p.name === name) as SeededPipeline);
}

export async function submitNote(page: Page, text: string) {
  const form = page.getByRole("form", { name: "HEL-1172 e2e Form" });
  await form.getByRole("textbox", { name: "Note" }).fill(text);
  await form.getByRole("button", { name: "Submit" }).click();
  await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);
  return form;
}

/** Stores the theme, reloads, and waits for it to apply (the app reads `helio-theme` on load). */
export async function applyTheme(page: Page, theme: "light" | "dark") {
  await page.goto("/dashboards");
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Vertical distance from the toast's variant icon top to the top of `selector` inside it (first match). */
export function iconToTextOffset(toast: Locator, selector: string): Promise<number> {
  return toast.evaluate((el, sel) => {
    const icon = el.querySelector(".toast__icon")?.getBoundingClientRect();
    const target = el.querySelector(sel)?.getBoundingClientRect();
    if (!icon || !target) throw new Error(`missing icon or ${sel}`);
    return target.top - icon.top;
  }, selector);
}
