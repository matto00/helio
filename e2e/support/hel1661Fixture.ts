import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { currentUserId, registerUser } from "./auth";

// HEL-1661: one owner-owned pipeline (a static source the grantees do not own, a compute step naming one of its
// columns, one Output) shared with an editor and a viewer, seeded through the real API with plain emails.

const CSRF = { "X-Helio-Requested-With": "1" };
export const OUTPUT_NAME = "hel1661-out";

export async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

export interface Collaborator {
  context: BrowserContext;
  page: Page;
  id: string;
}

export async function collaborator(
  browser: Browser,
  baseURL: string | undefined,
  label: string,
): Promise<Collaborator> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await registerUser(context.request, { prefix: "hel1661", label, displayName: "HEL-1661" });
  return { context, page, id: await currentUserId(context.request) };
}

/** The owner (already signed in on `page`) creates the pipeline and grants the two roles. */
export async function seedSharedPipeline(
  page: Page,
  editor: Collaborator,
  viewer: Collaborator,
): Promise<string> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1661-orders",
    type: "static",
    columns: [{ name: "amount", type: "integer" }],
    rows: [[1], [2], [3]],
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: `hel1661-pipe-${Date.now()}`,
    roots: [{ sourceId: source.id }],
    steps: [
      { clientId: "s0", type: "compute", config: { column: "double", expression: "$amount * 2" } },
    ],
    outputs: [{ nodeStepClientId: "s0", kind: "table", name: OUTPUT_NAME, config: {} }],
  });
  for (const [who, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const) {
    await post(page, `/api/pipelines/${pipeline.id}/permissions`, { granteeId: who.id, role });
  }
  return pipeline.id;
}

export async function openPipeline(
  page: Page,
  id: string,
  theme: "dark" | "light",
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/home");
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  // Wait on the analyze RESPONSE (the verdict and the role arrive with it), never a timeout.
  const analyzed = page.waitForResponse(
    (r) => r.url().includes(`/api/pipelines/${id}/analyze`) && r.status() === 200,
  );
  await page.goto(`/pipelines/${id}`);
  await analyzed;
  await expect(page.getByText("hel1661-orders").first()).toBeVisible();
}

export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 844 };
