import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1587 -- the public share viewer (`/dashboards/:id/panels?token=`) on a real build:
//   * lays panels out from the dashboard's STORED layout (read-only), two columns with an output panel, a markdown panel,
//     an image panel and a form panel, at BOTH lg and md of the stored layout. A 1440px viewport is a ~1408px CONTAINER
//     (the viewer keeps its side padding), so it resolves md; the spec asserts the resolved width, never assumes lg;
//   * at 375px the existing stacked list renders;
//   * markdown content and the image render for real, hostile markdown is inert (real react-markdown, which jest stubs);
//   * the form panel is a disabled preview: no submit button, no request to /submit;
//   * the dashboard's OWNER opening their own link sends no layout PATCH and no layout/repair request.
// Throwaway users are recorded by registerUser and deleted by exact id in the run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };

async function api<T>(
  request: APIRequestContext,
  method: "post" | "patch",
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res =
    method === "post"
      ? await request.post(url, { data, headers: CSRF })
      : await request.patch(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

const HOSTILE = [
  "# Story headline",
  "",
  "Body paragraph with **bold** text.",
  "",
  "<script>window.__pwned = 1</script>",
  "",
  '<img src="x" onerror="window.__pwned = 2">',
  "",
  "[bad link](javascript:window.__pwned=3)",
].join("\n");

const item = (panelId: string, x: number, y: number, w: number, h: number) => ({
  panelId,
  x,
  y,
  w,
  h,
});

interface Seed {
  dashboardId: string;
  token: string;
  ids: { out: string; md: string; img: string; frm: string };
}

async function seed(request: APIRequestContext, label: string): Promise<Seed> {
  const source = await api<{ id: string }>(
    request,
    "post",
    "/api/data-sources",
    {
      name: `HEL-1587 orders ${label}`,
      type: "static",
      columns: [
        { name: "region", type: "string" },
        { name: "amount", type: "integer" },
      ],
      rows: [
        ["east", 500],
        ["west", 575],
      ],
    },
    201,
  );
  const pipeline = await api<{ id: string }>(
    request,
    "post",
    "/api/pipelines",
    { name: `HEL-1587 pipeline ${label}`, roots: [{ sourceId: source.id }] },
    201,
  );
  const table = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/outputs`,
    { kind: "table", name: "Orders table", config: {} },
    201,
  );
  await api(request, "post", `/api/pipelines/${pipeline.id}/run`, {}, 200);
  const dataset = await api<{ id: string }>(
    request,
    "post",
    "/api/data-sources",
    {
      name: `HEL-1587 form ${label}`,
      type: "static",
      columns: [
        { name: "note", type: "string" },
        { name: "quantity", type: "integer", required: true },
      ],
      rows: [],
    },
    201,
  );
  const dash = await api<{ id: string }>(
    request,
    "post",
    "/api/dashboards",
    { name: `HEL-1587 board ${label}` },
    201,
  );
  const panel = async (title: string, type: string, config: unknown) =>
    (
      await api<{ id: string }>(
        request,
        "post",
        "/api/panels",
        { dashboardId: dash.id, title, type, config },
        201,
      )
    ).id;
  const out = await panel("Orders", "output", { outputId: table.id });
  const md = await panel("Story", "markdown", { content: HOSTILE });
  const img = await panel("Photo", "image", {
    imageUrl: "/orbit-mark.svg",
    imageFit: "contain",
    caption: "Orbit mark caption",
  });
  const frm = await panel("Intake", "form", {
    dataSourceId: dataset.id,
    fields: [
      { sourceField: "note", control: "text", label: "Note" },
      { sourceField: "quantity", control: "number", label: "Quantity" },
    ],
    submit: { writeMode: "append" },
  });
  // Two columns at BOTH lg and md; the form sits under the output, the image under the markdown.
  const current = (
    (await (await request.get("/api/dashboards?limit=500")).json()) as {
      items: { id: string; layoutVersion: number }[];
    }
  ).items.find((d) => d.id === dash.id)!;
  await api(
    request,
    "patch",
    `/api/dashboards/${dash.id}/update`,
    {
      fields: ["layout"],
      dashboard: {
        layout: {
          lg: [
            item(out, 0, 0, 6, 6),
            item(md, 6, 0, 6, 6),
            item(frm, 0, 6, 6, 6),
            item(img, 6, 6, 6, 6),
          ],
          md: [
            item(out, 0, 0, 5, 6),
            item(md, 5, 0, 5, 6),
            item(frm, 0, 6, 5, 6),
            item(img, 5, 6, 5, 6),
          ],
          sm: [
            item(out, 0, 0, 3, 6),
            item(md, 3, 0, 3, 6),
            item(frm, 0, 6, 3, 6),
            item(img, 3, 6, 3, 6),
          ],
          xs: [
            item(out, 0, 0, 2, 6),
            item(md, 0, 6, 2, 6),
            item(frm, 0, 12, 2, 6),
            item(img, 0, 18, 2, 6),
          ],
        },
        expectedLayoutVersion: current.layoutVersion,
      },
    },
    200,
  );
  const share = await api<{ token: string }>(
    request,
    "post",
    `/api/dashboards/${dash.id}/share-tokens`,
    {},
    201,
  );
  console.log(
    `[HEL-1587 e2e] created source ${source.id} ${dataset.id} pipeline ${pipeline.id} dashboard ${dash.id}`,
  );
  return { dashboardId: dash.id, token: share.token, ids: { out, md, img, frm } };
}

async function cellBox(page: Page, panelId: string) {
  const box = await page.locator(`[data-panel-id="${panelId}"]`).boundingBox();
  expect(box, `cell ${panelId}`).not.toBeNull();
  return box!;
}

async function processedWidth(page: Page): Promise<number> {
  return page.locator(".public-dashboard-viewer__grid").evaluate((el) => {
    const raw = getComputedStyle(el).getPropertyValue("--panel-grid-processed-width");
    return Number.parseFloat(raw);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`public viewer: stored two-column layout, content, form preview, owner writes nothing (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    // The session cookie lands in this page's context, so the page below is the dashboard OWNER opening their own link.
    await registerUser(page.request, {
      prefix: "hel1587",
      label: theme,
      displayName: "HEL-1587",
      logEmail: false,
    });
    const s = await seed(page.request, theme);

    const writes: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      const method = r.method();
      if (method === "GET") return;
      if (
        /\/layout\/repair$/.test(url.pathname) ||
        /^\/api\/dashboards\/[^/]+(\/update)?$/.test(url.pathname) ||
        /\/submit$/.test(url.pathname)
      ) {
        writes.push(`${method} ${url.pathname}`);
      }
    });

    // ── Desktop: 1440px viewport, a ~1408px container, breakpoint md ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboards/${s.dashboardId}/panels?token=${s.token}`);
    await expect(page.locator(".public-dashboard-viewer__grid")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => processedWidth(page)).toBeGreaterThanOrEqual(1100);
    const width = await processedWidth(page);
    // md is [1100, 1440): a 1440px viewport is NOT lg.
    expect(width, `container ${width}`).toBeLessThan(1440);
    await expect(page.getByText("Orders").first()).toBeVisible();
    await expect(page.getByText("east")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("h1").filter({ hasText: "Story headline" })).toBeVisible({
      timeout: 20_000,
    });

    const out = await cellBox(page, s.ids.out);
    const md = await cellBox(page, s.ids.md);
    const frm = await cellBox(page, s.ids.frm);
    const img = await cellBox(page, s.ids.img);
    // Two columns: markdown right of the output at the same top, form under the output, image under the markdown.
    expect(Math.abs(md.y - out.y)).toBeLessThan(2);
    expect(md.x).toBeGreaterThan(out.x + out.width - 2);
    expect(frm.y).toBeGreaterThan(out.y + out.height - 2);
    expect(Math.abs(frm.x - out.x)).toBeLessThan(2);
    expect(Math.abs(img.x - md.x)).toBeLessThan(2);

    // Markdown: real renderer, hostile parts inert.
    const mdCell = page.locator(`[data-panel-id="${s.ids.md}"]`);
    await expect(mdCell.locator("strong")).toHaveText("bold");
    await expect(mdCell.locator("script, [onerror], a[href^='javascript']")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();

    // Image: loaded for real, with its caption.
    const imgEl = page.locator(`[data-panel-id="${s.ids.img}"] img`);
    await expect(imgEl).toBeVisible();
    await expect
      .poll(() => imgEl.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByText("Orbit mark caption")).toBeVisible();

    // Form: a disabled preview, no submit control.
    const formCell = page.locator(`[data-panel-id="${s.ids.frm}"]`);
    await expect(formCell.getByText("Read-only preview")).toBeVisible({ timeout: 20_000 });
    await expect(formCell.getByLabel("Note")).toBeDisabled();
    await expect(formCell.getByLabel("Quantity")).toBeDisabled();
    await expect(formCell.locator("form, button[type='submit']")).toHaveCount(0);
    await formCell.getByLabel("Note").click({ force: true });
    await page.keyboard.type("hello");

    // No edit affordance on any cell.
    await expect(page.locator(".panel-grid-card__handle")).toHaveCount(0);

    await page.screenshot({
      path: evidencePath("HEL-1587", `public-md-1440-${theme}.png`),
      fullPage: true,
    });

    // ── Wide: a 1700px viewport is lg (a >= 1440px container) at the stored lg layout ──
    await page.setViewportSize({ width: 1700, height: 900 });
    await expect.poll(() => processedWidth(page)).toBeGreaterThanOrEqual(1440);
    const outLg = await cellBox(page, s.ids.out);
    const mdLg = await cellBox(page, s.ids.md);
    expect(Math.abs(mdLg.y - outLg.y)).toBeLessThan(2);
    expect(mdLg.x).toBeGreaterThan(outLg.x + outLg.width - 2);
    await page.screenshot({
      path: evidencePath("HEL-1587", `public-lg-1700-${theme}.png`),
      fullPage: true,
    });

    // ── Phone: 375px keeps the stacked list ──
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator("ul[aria-label='Dashboard panels']")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".public-dashboard-viewer__grid")).toHaveCount(0);
    // The stack follows the stored xs arrangement (output, markdown, form, image), not the API's newest-first order.
    await expect(page.locator(".public-dashboard-viewer__panel-title")).toHaveText([
      "Orders",
      "Story",
      "Intake",
      "Photo",
    ]);
    // The output's provenance trigger sits beside its title, in the same row.
    await expect(
      page
        .locator(".public-dashboard-viewer__title-row")
        .first()
        .getByRole("button", { name: "Data provenance" }),
    ).toBeVisible();
    await expect(page.locator("h1").filter({ hasText: "Story headline" })).toBeVisible();
    await page.screenshot({
      path: evidencePath("HEL-1587", `public-375-${theme}.png`),
      fullPage: true,
    });

    // Resizing across breakpoints as the owner wrote nothing.
    expect(writes, writes.join(", ")).toEqual([]);
  });
}
