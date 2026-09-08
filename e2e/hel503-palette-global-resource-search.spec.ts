import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-503 — real-browser proof that resource search works on `/` with NO prior navigation
// (the ticket's PRIMARY acceptance criterion), across all four kinds (dashboard/source/
// pipeline/output). Follows the shape of e2e/hel519-recent-navigation.spec.ts.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel503-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

// tasks.md 5.4 — this file's OWN copy of the post-mount precondition wait, not a shared helper
// (`c317e244` fixed only 2 of 8 duplicated copies — omitting it here reintroduces the mount-
// timing race that took main red).
//
// tasks.md 5.1 (skeptic CR4) — the account this creates is given a dashboard IMMEDIATELY
// (before any navigation), so `useOnboardingHost.ts`'s auto-activation
// (`dashboards.status === "succeeded" && items.length === 0`) never fires and never fetches
// sources/pipelines on its own — the exact condition that would make the "remove the
// palette-open fetch" mutation below stay green while proving nothing.
async function registerAndLoginWithDashboard(
  page: Page,
  request: APIRequestContext,
  label: string,
) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-503 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");

  const dashRes = await request.post("/api/dashboards", {
    data: { name: `HEL-503 ${label} Dashboard` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashRes.status()).toBe(201);
  const dashboard = (await dashRes.json()) as { id: string; name: string };
  return dashboard;
}

async function createStaticSource(request: APIRequestContext, name: string) {
  const res = await request.post("/api/data-sources", {
    data: { name, type: "static", columns: [{ name: "amount", type: "integer" }], rows: [[1]] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createPipeline(request: APIRequestContext, name: string, sourceId: string) {
  const res = await request.post("/api/pipelines", {
    data: { name, roots: [{ sourceId }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createOutput(request: APIRequestContext, pipelineId: string, name: string) {
  const res = await request.post(`/api/pipelines/${pipelineId}/outputs`, {
    data: { kind: "table", name, config: {} },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string; pipelineId: string };
}

async function openPalette(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(
      async () => {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
        return page.locator(".command-palette[open]").count();
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
}

test.describe("HEL-503 global resource search — the / route, primary acceptance test", () => {
  // tasks.md 5.1 — THE PRIMARY ACCEPTANCE TEST. No navigation happens between login and search:
  // `/` is where every non-dashboard slice starts genuinely empty (design.md D2), so this is the
  // one path that would fail if indexing were only ever triggered by visiting a resource's own
  // page (HEL-519's exact class of defect, one level up).
  test("searching for a source and a pipeline on / with NO prior navigation finds both", async ({
    page,
    request,
  }) => {
    await registerAndLoginWithDashboard(page, request, "root-search");
    const source = await createStaticSource(request, "HEL-503 Alpha Source");
    const pipeline = await createPipeline(request, "HEL-503 Alpha Pipeline", source.id);

    // Reload lands fresh on `/` with an EMPTY client-side Redux store — sources/pipelines have
    // never been fetched by anything on this route (design.md D2's load-timing survey).
    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', "HEL-503 Alpha");

    await expect(page.getByRole("option", { name: source.name })).toBeVisible();
    await expect(page.getByRole("option", { name: pipeline.name })).toBeVisible();
  });

  test("searching for an output on / with NO prior navigation finds it, and selecting it opens the pipeline sheet", async ({
    page,
    request,
  }) => {
    await registerAndLoginWithDashboard(page, request, "root-output");
    const source = await createStaticSource(request, "HEL-503 Output Source");
    const pipeline = await createPipeline(request, "HEL-503 Output Pipeline", source.id);
    const output = await createOutput(request, pipeline.id, "HEL-503 Revenue Output");

    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', "Revenue Output");
    const option = page.getByRole("option", { name: output.name });
    await expect(option).toBeVisible();

    await option.click();
    // task 5.2 — the pipeline sheet is PRESENTED, not just the pipeline page.
    await page.waitForURL(new RegExp(`/pipelines/${pipeline.id}\\?outputId=${output.id}`));
    await expect(page.getByRole("heading", { name: output.name })).toBeVisible();
  });

  test("searching for a dashboard by name selects it without leaving /", async ({
    page,
    request,
  }) => {
    // A SECOND dashboard so selecting the first one via the palette is an observable change —
    // `fetchDashboards.fulfilled` auto-selects whichever dashboard happens to be first, so with
    // only one dashboard, selecting it via search would be indistinguishable from doing nothing.
    const firstDashboard = await registerAndLoginWithDashboard(page, request, "root-dashboard");
    const secondRes = await request.post("/api/dashboards", {
      data: { name: "HEL-503 root-dashboard Second" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(secondRes.status()).toBe(201);
    const secondDashboard = (await secondRes.json()) as { id: string; name: string };

    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();
    // The auto-selected dashboard is whichever loaded first; select the SECOND one via the
    // sidebar list first so the palette's own selection (of the FIRST) below is a real change.
    await page.locator(".dashboard-list__name", { hasText: secondDashboard.name }).click();

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', firstDashboard.name);
    await expect(page.getByRole("option", { name: firstDashboard.name })).toBeVisible();
    await page.getByRole("option", { name: firstDashboard.name }).click();

    // The FIRST dashboard's row now carries the active-dot indicator.
    const firstRow = page
      .locator(".dashboard-list__name", { hasText: firstDashboard.name })
      .locator("..")
      .locator("..");
    await expect(firstRow.getByLabel("Active dashboard")).toBeVisible();
  });

  test("selecting a source result navigates to its detail page from /", async ({
    page,
    request,
  }) => {
    await registerAndLoginWithDashboard(page, request, "root-source-nav");
    const source = await createStaticSource(request, "HEL-503 Navigable Source");

    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', "Navigable Source");
    await page.getByRole("option", { name: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));
  });

  // tasks.md 5.1 — FAILABLE BY MUTATION, RUN AND CONFIRMED (against the live dev server, not
  // inferred): replacing the four `void dispatch(fetch...())` calls in
  // `useResourceIndexing.ts`'s open-edge effect with a no-op turned the three indexing-dependent
  // tests above (source/pipeline, output, source-navigation) RED — the palette opened but found
  // nothing on `/`, because `sources`/`pipelines`/`outputs` were never fetched. Restoring the
  // dispatches turned all three back green. Both runs observed directly, not repeated here.
  test("the palette names which kinds are still loading immediately after opening, on a slow network", async ({
    page,
    request,
  }) => {
    await registerAndLoginWithDashboard(page, request, "coverage");
    await page.route("**/api/data-sources", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await openPalette(page);
    // Right after opening, at least one kind has not resolved yet — the coverage caveat must
    // name it rather than staying silent (design.md D4).
    await expect(page.locator(".command-palette__coverage")).toBeVisible();
  });

  // Skeptic-final-1 CR1/CR2 (final gate, round 1) — the skeptic clicked the overflow row live
  // and found it closed the palette, cleared the query, and navigated nowhere. This is the
  // real-browser proof both findings are fixed: the row is not reachable by keyboard, cannot be
  // clicked into anything, and its text lines up with every other row's text column.
  test("the overflow notice is unreachable by keyboard, unclickable, and aligned with icon rows", async ({
    page,
    request,
  }) => {
    await registerAndLoginWithDashboard(page, request, "overflow");
    // 7 sources matching "Zeta" — one more than the cap (5), so exactly one overflow notice
    // ("+2 more sources match …") is produced.
    for (let i = 0; i < 7; i++) {
      await createStaticSource(request, `HEL-503 Zeta Source ${i}`);
    }

    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', "Zeta Source");

    const options = page.getByRole("option");
    await expect(options).toHaveCount(5);

    const notice = page.getByText(/\+2 more sources match/i);
    await expect(notice).toBeVisible();

    // CR2 — not in keyboard traversal: ArrowDown one more time than there are options never
    // lands on the notice (aria-activedescendant only ever names a real option).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowDown");
    }
    const combobox = page.locator('input[aria-label="Search commands"]');
    const activeDescendant = await combobox.getAttribute("aria-activedescendant");
    expect(activeDescendant).not.toContain("overflow");
    // Attribute selector, not `#id` — the palette's ids embed literal `.` characters
    // (`command-palette-option-search.source.<uuid>`), which a CSS ID selector would
    // misinterpret as a class-selector separator.
    await expect(page.locator(`[id="${activeDescendant}"]`)).toHaveAttribute("role", "option");

    // CR2 — not clickable into anything: clicking it must NOT close the palette or clear the
    // query (both of which the skeptic observed on the pre-fix `<button role="option">` shape).
    await notice.click({ force: true });
    await expect(page.locator(".command-palette[open]")).toHaveCount(1);
    await expect(combobox).toHaveValue("Zeta Source");

    // CR1 — measured computed-style alignment, not by eye: the notice's text starts at the SAME
    // x-coordinate as a real option's text (both measured against the palette's own left edge),
    // because `.command-palette__notice-icon` reserves the same gutter width
    // `.command-palette__item-icon` does.
    const noticeBox = await notice.boundingBox();
    const optionTitle = page.locator(".command-palette__item-title").first();
    const optionTitleBox = await optionTitle.boundingBox();
    expect(noticeBox).not.toBeNull();
    expect(optionTitleBox).not.toBeNull();
    expect(Math.abs(noticeBox!.x - optionTitleBox!.x)).toBeLessThanOrEqual(1);
  });
});
