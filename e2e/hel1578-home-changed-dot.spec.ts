import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";

// HEL-1578 tasks.md 3.3 (Phase B) -- the Home shelf's "changed since your last visit" dot against the real backend:
// it shows after another session's edit or new data, clears after opening the dashboard, never shows for the user's
// own edit followed by a plain-click switch, leaves Y's dot when X is opened from Home, and survives twelve
// pipeline visits. The page itself never makes the edits that must mark (they come over `request`, which is another
// session as far as the page's change tracking is concerned).

test.describe.configure({ mode: "parallel" });
test.setTimeout(240_000);

const AUTH = {
  prefix: "hel1578",
  displayName: "HEL-1578",
  domain: "example.com",
  isolate: true,
} as const;
const VIEWPORT = { width: 1440, height: 900 };

interface Seeded {
  dashboards: Record<"A" | "B", string>;
  notes: Record<"A" | "B", string>;
  pipelines: Record<"A" | "B", string>;
}

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const out = { dashboards: {}, notes: {}, pipelines: {} } as Seeded;
  for (const key of ["A", "B"] as const) {
    const name = `Dot ${key}`;
    const dash = await post<{ id: string }>(request, "/api/dashboards", { name });
    const source = await post<{ id: string }>(request, "/api/data-sources", {
      name: `${name} source`,
      type: "static",
      columns: [{ name: "n", type: "integer", required: true }],
      rows: [[1], [2]],
    });
    const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
      name: `${name} pipeline`,
      roots: [{ sourceId: source.id }],
    });
    const output = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "table",
      name: `${name} output`,
      config: {},
    });
    await post(request, `/api/pipelines/${pipeline.id}/run`, {});
    await post(request, "/api/panels", {
      dashboardId: dash.id,
      title: `${name} table`,
      type: "output",
      config: { outputId: output.id },
    });
    const note = await post<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title: `${name} note`,
      type: "markdown",
      config: { content: `${name} body` },
    });
    out.dashboards[key] = dash.id;
    out.notes[key] = note.id;
    out.pipelines[key] = pipeline.id;
  }
  return out;
}

async function view(page: Page, id: string, name: string) {
  await page.goto(`/dashboards/${id}`);
  await expect(page.getByRole("heading", { name: `${name} note` })).toBeVisible();
  // The view stamp is written once the dashboard is displayed; leave it a moment so a later edit is strictly after it.
  await page.waitForTimeout(1_200);
}

async function goHome(page: Page) {
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("region", { name: "Home" })).toBeVisible();
}

const card = (page: Page, name: string) =>
  page.getByRole("region", { name: "Home" }).getByRole("link", { name: new RegExp(`^${name}`) });
const CHANGED = /changed since your last visit/;

async function editElsewhere(request: APIRequestContext, noteId: string, title: string) {
  const res = await request.patch(`/api/panels/${noteId}`, {
    data: { title },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBeLessThan(300);
}

async function viewBoth(page: Page, request: APIRequestContext) {
  await page.setViewportSize(VIEWPORT);
  await registerAndLogin(page, request, AUTH);
  const ws = await seed(request);
  await view(page, ws.dashboards.A, "Dot A");
  await view(page, ws.dashboards.B, "Dot B");
  await goHome(page);
  await expect(card(page, "Dot A")).toBeVisible();
  await expect(page.getByText(CHANGED)).toHaveCount(0);
  return ws;
}

test.describe("HEL-1578 Home changed dot (real backend)", () => {
  test("shows after another session's edit, clears after opening the dashboard, and Home adds one request of its own", async ({
    page,
    request,
  }) => {
    const ws = await viewBoth(page, request);
    await editElsewhere(request, ws.notes.A, "Dot A edited elsewhere");

    const calls: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/api/"))
        calls.push(`${r.method()} ${url.pathname}${url.search ? "?…" : ""}`);
    });
    await page.goto("/home");
    await expect(card(page, "Dot A")).toHaveAccessibleName(/Dot A.*changed since your last visit/);
    await expect(card(page, "Dot B")).not.toHaveAccessibleName(CHANGED);
    // The shelf puts the changed dashboard first.
    await expect(
      page.getByRole("region", { name: "Home" }).locator(".home-shelf a").first(),
    ).toContainText("Dot A");

    console.log(`[HEL-1578 request list on /home]\n${calls.join("\n")}`);
    expect(calls.filter((c) => c.startsWith("GET /api/home-summary"))).toHaveLength(1);
    expect(calls.filter((c) => /^\w+ \/api\/pipelines\/[^/]+\//.test(c))).toEqual([]);
    expect(calls.length).toBeLessThan(25);

    await card(page, "Dot A").click();
    await expect(page.getByRole("heading", { name: "Dot A edited elsewhere" })).toBeVisible();
    await page.waitForTimeout(500);
    await goHome(page);
    await expect(card(page, "Dot A")).not.toHaveAccessibleName(CHANGED);
  });

  test("shows after new data (a run), and clears after opening", async ({ page, request }) => {
    const ws = await viewBoth(page, request);
    await post(request, `/api/pipelines/${ws.pipelines.B}/run`, {});
    await page.goto("/home");
    await expect(card(page, "Dot B")).toHaveAccessibleName(/changed since your last visit/);
    await card(page, "Dot B").click();
    await expect(page.getByRole("heading", { name: "Dot B note" })).toBeVisible();
    await page.waitForTimeout(500);
    await goHome(page);
    await expect(card(page, "Dot B")).not.toHaveAccessibleName(CHANGED);
  });

  test("an own edit followed by a plain-click switch never marks the edited dashboard", async ({
    page,
    request,
  }) => {
    const ws = await viewBoth(page, request);
    await page.goto(`/dashboards/${ws.dashboards.A}`);
    await expect(page.getByRole("heading", { name: "Dot A note" })).toBeVisible();
    await page.getByRole("button", { name: "Dot A note panel actions" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByLabel("Panel title");
    await input.fill("Dot A note renamed");
    const flushed = page.waitForResponse(
      (r) => r.request().method() !== "GET" && r.url().includes("/api/panels"),
    );
    await input.press("Enter");
    await expect(page.getByRole("heading", { name: "Dot A note renamed" })).toBeVisible();
    // A plain click on the other dashboard in the list: the edit is flushed on leave.
    await page
      .locator(".dashboard-list")
      .getByRole("button", { name: "Dot B", exact: true })
      .click();
    await flushed;
    await expect(page.getByRole("heading", { name: "Dot B note" })).toBeVisible();
    await page.waitForTimeout(1_500);
    await goHome(page);
    await expect(card(page, "Dot A")).toBeVisible();
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });

  test("opening X from Home while Y is selected leaves Y's dot", async ({ page, request }) => {
    const ws = await viewBoth(page, request);
    await editElsewhere(request, ws.notes.A, "Dot A moved");
    await editElsewhere(request, ws.notes.B, "Dot B moved");
    await page.goto("/home");
    await expect(card(page, "Dot A")).toHaveAccessibleName(CHANGED);
    await expect(card(page, "Dot B")).toHaveAccessibleName(CHANGED);
    await card(page, "Dot A").click();
    await expect(page.getByRole("heading", { name: "Dot A moved" })).toBeVisible();
    await page.waitForTimeout(500);
    await goHome(page);
    await expect(card(page, "Dot A")).not.toHaveAccessibleName(CHANGED);
    await expect(card(page, "Dot B")).toHaveAccessibleName(CHANGED);
  });

  test("visiting twelve pipelines does not evict a dashboard's stamp", async ({
    page,
    request,
  }) => {
    const ws = await viewBoth(page, request);
    const source = await post<{ id: string }>(request, "/api/data-sources", {
      name: "Many source",
      type: "static",
      columns: [{ name: "n", type: "integer", required: true }],
      rows: [[1]],
    });
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const p = await post<{ id: string }>(request, "/api/pipelines", {
        name: `Many ${i}`,
        roots: [{ sourceId: source.id }],
      });
      ids.push(p.id);
    }
    // Let the per-user /api rate window (120 requests per 60 s) roll over before the twelve page loads.
    await page.waitForTimeout(62_000);
    for (const [i, id] of ids.entries()) {
      // Two batches of six page loads, a rate window apart: each load makes about ten /api requests.
      if (i === 6) await page.waitForTimeout(62_000);
      await page.goto(`/pipelines/${id}`);
      await expect(page.getByText(`Many ${i}`).first()).toBeVisible();
    }
    await editElsewhere(request, ws.notes.A, "Dot A after pipelines");
    await page.goto("/home");
    await expect(card(page, "Dot A")).toHaveAccessibleName(CHANGED);
  });
});
